import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createHmac } from "node:crypto";
import { brand } from "@/config/brand";

// The tracking secret is resolved through getSecret(), which is backed by
// prisma.secret. Mock at the prisma boundary (same approach as drip-from.test)
// so the real DB → env → undefined resolution order is exercised.
let secretRow: { kind: string; valuePlain: string | null } | null = null;

mock.module("@/lib/prisma", () => ({
  default: {
    secret: {
      findUnique: async () => secretRow,
    },
  },
}));

const {
  createTrackingSigner,
  verifyToken,
  isHttpUrl,
  hashIp,
  trackingStatus,
  resetTrackingWarnLatchForTests,
} = await import(
  "@/lib/drip/tracking"
);
const { renderStepHtml } = await import("@/lib/drip/template");
const { bustSecretCache } = await import("@/lib/secrets");
const { logger } = await import("@/lib/logger");
const { KNOWN_INTEGRATION_KEYS } = await import(
  "@/app/(dashboard)/admin/integrations/knownKeys"
);

const SECRET = "test-tracking-secret";

/**
 * Controls BOTH resolution layers. getSecret falls back to process.env, and a
 * developer's local .env may well define these keys — without clearing them,
 * the "no secret configured" case would silently test the wrong thing.
 */
function useSecret(value: string | null) {
  secretRow = value === null ? null : { kind: "config", valuePlain: value };
  if (value === null) {
    delete process.env.DRIP_TRACKING_SECRET;
    delete process.env.DRIP_TRACKING_SALT;
  } else {
    process.env.DRIP_TRACKING_SECRET = value;
  }
  bustSecretCache("DRIP_TRACKING_SECRET");
  bustSecretCache("DRIP_TRACKING_SALT");
}

const signerArgs = {
  kind: "drip" as const,
  refId: "send_123",
  contactId: "contact_456",
  baseUrl: brand.urls.hub,
};

beforeEach(() => {
  useSecret(SECRET);
});

describe("createTrackingSigner", () => {
  it("SC6.1: an empty secret returns null and warns exactly once per process", async () => {
    useSecret(null);
    resetTrackingWarnLatchForTests();
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => undefined);

    try {
      expect(await createTrackingSigner(signerArgs)).toBeNull();
      expect(await createTrackingSigner(signerArgs)).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.join(" ")).toContain("DRIP_TRACKING_SECRET");
      expect(warnSpy.mock.calls[0]?.join(" ")).toContain("untracked");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("builds open and click URLs under the app's own origin", async () => {
    const signer = await createTrackingSigner(signerArgs);
    expect(signer!.openUrl()).toStartWith(`${brand.urls.hub}/api/e/o/`);
    expect(signer!.clickUrl("https://example.com/x")).toStartWith(
      `${brand.urls.hub}/api/e/c/`
    );
  });

  it("strips a trailing slash from the base URL rather than doubling it", async () => {
    const signer = await createTrackingSigner({ ...signerArgs, baseUrl: "https://h.test/" });
    expect(signer!.openUrl()).toStartWith("https://h.test/api/e/o/");
  });

  it("refuses to wrap non-http destinations", async () => {
    const signer = await createTrackingSigner(signerArgs);
    expect(signer!.clickUrl(`mailto:${brand.email.contact}`)).toBeNull();
    expect(signer!.clickUrl("/relative/path")).toBeNull();
    expect(signer!.clickUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("tracking configuration", () => {
  it("SC6.2: knownKeys registers DRIP_TRACKING_SECRET as a comms secret", () => {
    const entry = KNOWN_INTEGRATION_KEYS.find(
      (candidate) => candidate.key === "DRIP_TRACKING_SECRET"
    );

    expect(entry).toMatchObject({ kind: "secret", category: "comms" });
  });

  it("SC6.3: trackingStatus reports disabled when the secret is unset", async () => {
    useSecret(null);
    expect(await trackingStatus()).toEqual({ enabled: false });
  });
});

describe("verifyToken", () => {
  function tokenFrom(url: string): string {
    return url.split("/").pop()!;
  }

  function signedToken(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  it("accepts a legacy drip token with no target kind", async () => {
    const token = signedToken({ k: "o", s: "legacy_send", c: "contact_456" });
    expect(await verifyToken(token)).toEqual({
      k: "o",
      s: "legacy_send",
      c: "contact_456",
      t: "drip",
    });
  });

  it("round-trips a new drip token", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const payload = await verifyToken(tokenFrom(signer!.openUrl()));
    expect(payload).toEqual({ k: "o", s: "send_123", c: "contact_456", t: "drip" });
  });

  it("round-trips a one-off token", async () => {
    const signer = await createTrackingSigner({
      ...signerArgs,
      kind: "oneoff",
      refId: "event_789",
    });
    const url = "https://example.com/landing?utm_source=email";
    const payload = await verifyToken(tokenFrom(signer!.clickUrl(url)!));
    expect(payload).toEqual({
      k: "c",
      s: "event_789",
      c: "contact_456",
      t: "oneoff",
      u: url,
    });
  });

  it("rejects a token whose signature was tampered with", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const token = tokenFrom(signer!.clickUrl("https://example.com/x")!);
    const [body, sig] = token.split(".");
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(await verifyToken(`${body}.${flipped}`)).toBeNull();
  });

  it("rejects a token whose PAYLOAD was tampered with — no open redirect", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const token = tokenFrom(signer!.clickUrl("https://example.com/x")!);
    const sig = token.split(".")[1];
    // Re-encode the payload pointing at an attacker's site, keep the old signature.
    const evil = Buffer.from(
      JSON.stringify({ k: "c", s: "send_123", c: "contact_456", u: "https://evil.test" })
    ).toString("base64url");
    expect(await verifyToken(`${evil}.${sig}`)).toBeNull();
  });

  it("rejects a validly signed token with the wrong kind discriminator", async () => {
    expect(
      await verifyToken(signedToken({ k: "x", s: "send_123", c: "contact_456", t: "drip" }))
    ).toBeNull();
  });

  it("rejects a validly signed click token with a non-http destination", async () => {
    expect(
      await verifyToken(
        signedToken({
          k: "c",
          s: "send_123",
          c: "contact_456",
          t: "drip",
          u: "javascript:alert(1)",
        })
      )
    ).toBeNull();
  });

  it("rejects malformed tokens instead of throwing", async () => {
    expect(await verifyToken("")).toBeNull();
    expect(await verifyToken("no-dot")).toBeNull();
    expect(await verifyToken("a.b.c")).toBeNull();
    expect(await verifyToken("!!!.!!!")).toBeNull();
  });

  it("verifies nothing once the secret is gone", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const token = tokenFrom(signer!.openUrl());
    useSecret(null);
    expect(await verifyToken(token)).toBeNull();
  });

  it("does not accept a token signed with a different secret", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const token = tokenFrom(signer!.openUrl());
    useSecret("a-completely-different-secret");
    expect(await verifyToken(token)).toBeNull();
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https only", () => {
    expect(isHttpUrl("http://a.test")).toBe(true);
    expect(isHttpUrl("https://a.test")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("mailto:a@b.test")).toBe(false);
    expect(isHttpUrl("/relative")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("hashIp", () => {
  it("is stable, salted, truncated, and never the raw address", async () => {
    const a = await hashIp("203.0.113.7");
    expect(a).not.toBeNull();
    expect(a).not.toContain("203.0.113.7");
    expect(a).toHaveLength(16);
    expect(await hashIp("203.0.113.7")).toBe(a!);
    expect(await hashIp("203.0.113.8")).not.toBe(a!);
  });

  it("returns null for a missing address", async () => {
    expect(await hashIp(null)).toBeNull();
  });
});

describe("renderStepHtml tracking", () => {
  const step = {
    subject: "Hello {{first_name}}",
    body: `<p>Read the <a href="${brand.urls.hub}/courses">courses</a>.</p>`,
    ctaLabel: "Join",
    ctaUrl: `${brand.urls.hub}/cohorts`,
    order: 1,
  };
  const baseCtx = {
    name: "Jane Founder",
    email: "jane@example.com",
    unsubscribeUrl: `${brand.urls.hub}/unsubscribe?token=abc`,
    appUrl: brand.urls.hub,
    campaignSlug: "agency-launch-nurture",
  };

  it("is byte-identical to the untracked render when no signer is supplied", () => {
    const withoutKey = renderStepHtml(step, baseCtx);
    const withUndefined = renderStepHtml(step, { ...baseCtx, tracking: undefined });
    expect(withUndefined).toBe(withoutKey);
    expect(withoutKey).not.toContain("/api/e/");
  });

  it("wraps links and appends the pixel when a signer is supplied", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const html = renderStepHtml(step, { ...baseCtx, tracking: signer! });

    expect(html).toContain("/api/e/o/"); // pixel
    expect(html).toContain("/api/e/c/"); // wrapped links
    // Pixel sits inside the document body.
    expect(html.indexOf("/api/e/o/")).toBeLessThan(html.indexOf("</body>"));
    // The original destinations are no longer directly linked.
    expect(html).not.toContain(`href="${brand.urls.hub}/courses?`);
  });

  it("never wraps the unsubscribe link — opt-out must not be click-tracked", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const html = renderStepHtml(step, { ...baseCtx, tracking: signer! });
    expect(html).toContain(`href="${baseCtx.unsubscribeUrl}"`);
  });

  it("seals the fully UTM-tagged destination inside the click token", async () => {
    const signer = await createTrackingSigner(signerArgs);
    const html = renderStepHtml(step, { ...baseCtx, tracking: signer! });

    const token = html.match(/\/api\/e\/c\/([A-Za-z0-9_\-.]+)"/)![1];
    const payload = (await verifyToken(token)) as { u: string };
    expect(payload.u).toContain("utm_source=email");
    expect(payload.u).toStartWith(`${brand.urls.hub}/`);
  });
});
