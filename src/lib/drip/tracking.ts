// src/lib/drip/tracking.ts
//
// Signed tokens for the open pixel and click redirect.
//
// There is deliberately NO token table. Everything the endpoint needs travels
// inside the token, HMAC-signed, so a tracking link is self-describing and
// stateless. The important consequence: because the destination URL is *inside
// the signed payload*, the click endpoint can never be turned into an open
// redirect — an attacker cannot swap the URL without invalidating the signature.
//
// Token shape: base64url(JSON payload) + "." + base64url(HMAC-SHA256)

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";
import { getSecret } from "@/lib/secrets";

let warnedAboutMissingTrackingSecret = false;

/**
 * Clears the once-per-process "tracking is unconfigured" warn latch.
 *
 * Exported solely so a test asserting the latch is not order-dependent: any
 * other test file that renders an untracked email consumes the single warn
 * first, which would otherwise make that assertion pass or fail based on test
 * file ordering. Production code must never call this — the latch existing is
 * the point.
 */
export function resetTrackingWarnLatchForTests(): void {
  warnedAboutMissingTrackingSecret = false;
}

/** Payload written into an open-pixel token. */
export type OpenPayload = {
  k: "o";
  /** DripSend id for drip mail; EmailEvent id for one-off mail. */
  s: string;
  /** Contact id. */
  c: string;
  /** Absent on legacy tokens, which always resolve to drip. */
  t: TrackingTargetKind;
};

/** Payload written into a click-redirect token. */
export type ClickPayload = {
  k: "c";
  s: string;
  c: string;
  t: TrackingTargetKind;
  /** Destination URL — signed, so it cannot be tampered with. */
  u: string;
};

export type TrackingPayload = OpenPayload | ClickPayload;
export type TrackingTargetKind = "drip" | "oneoff";

type SignedTrackingPayload =
  | Omit<OpenPayload, "t"> & { t?: TrackingTargetKind }
  | Omit<ClickPayload, "t"> & { t?: TrackingTargetKind };

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

/**
 * Resolved per call, never at module scope: `next build` evaluates route modules
 * with no env at all, and a module-level secret read would fail the build gate.
 */
async function trackingSecret(): Promise<string | null> {
  const fromStore = await getSecret("DRIP_TRACKING_SECRET");
  const secret = (fromStore ?? process.env.DRIP_TRACKING_SECRET ?? "").trim();
  return secret.length > 0 ? secret : null;
}

/** Reports whether outgoing email can include signed open/click tracking. */
export async function trackingStatus(): Promise<{ enabled: boolean }> {
  // Intentionally no local timeout: status uses the same cached Prisma-backed
  // configuration lookup as sending, so the UI cannot disagree with the mail path.
  return { enabled: Boolean(await trackingSecret()) };
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function signPayload(payload: SignedTrackingPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/**
 * A synchronous signer bound to an already-resolved secret.
 *
 * Rendering an email needs one token per link, but secret resolution is async
 * (it may hit the DB-backed Integrations store). Resolving once per send and
 * handing the renderer this object keeps `renderStepHtml` synchronous — the
 * alternative would be making the whole render path async purely to fetch a
 * value that is identical for every link in the message.
 */
export type TrackingSigner = {
  /** Absolute base URL of this app, used to build tracking links. */
  baseUrl: string;
  openUrl(): string;
  /** Wrapped click URL for `destination`, or null if it shouldn't be wrapped. */
  clickUrl(destination: string): string | null;
};

/**
 * Builds a signer for one send, or returns null when tracking is not configured
 * (no `DRIP_TRACKING_SECRET`). A null return means "send untracked" — never a
 * thrown error, because a missing analytics secret must not stop the mail.
 */
export async function createTrackingSigner(p: {
  kind: TrackingTargetKind;
  refId: string;
  contactId: string;
  baseUrl: string;
}): Promise<TrackingSigner | null> {
  const secret = await trackingSecret();
  if (!secret) {
    if (!warnedAboutMissingTrackingSecret) {
      warnedAboutMissingTrackingSecret = true;
      logger.warn(
        "DRIP_TRACKING_SECRET is unset; email sends are going out untracked."
      );
    }
    return null;
  }
  const base = p.baseUrl.replace(/\/+$/, "");

  return {
    baseUrl: base,
    openUrl() {
      const token = signPayload({ k: "o", s: p.refId, c: p.contactId, t: p.kind }, secret);
      return `${base}/api/e/o/${token}`;
    },
    clickUrl(destination: string) {
      if (!isHttpUrl(destination)) return null;
      const token = signPayload({
        k: "c",
        s: p.refId,
        c: p.contactId,
        t: p.kind,
        u: destination,
      }, secret);
      return `${base}/api/e/c/${token}`;
    },
  };
}

/**
 * Verifies a token and returns its payload, or null for anything suspicious:
 * malformed shape, bad signature, unknown kind, or a click payload whose URL is
 * not http(s). Never throws — callers are public endpoints that must degrade
 * quietly rather than 500.
 */
export async function verifyToken(token: string): Promise<TrackingPayload | null> {
  const secret = await trackingSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, providedSig] = parts;
  if (!body || !providedSig) return null;

  const expectedSig = sign(body, secret);
  const provided = Buffer.from(providedSig);
  const expected = Buffer.from(expectedSig);
  // timingSafeEqual throws on length mismatch, so check that first.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.s !== "string" || typeof p.c !== "string") return null;
  const targetKind = p.t === undefined ? "drip" : p.t;
  if (targetKind !== "drip" && targetKind !== "oneoff") return null;

  if (p.k === "o") return { k: "o", s: p.s, c: p.c, t: targetKind };
  if (p.k === "c") {
    if (typeof p.u !== "string" || !isHttpUrl(p.u)) return null;
    return { k: "c", s: p.s, c: p.c, t: targetKind, u: p.u };
  }
  return null;
}

/** Only http(s) destinations are ever signed or followed. */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Salted, truncated hash of a client IP. We keep enough to distinguish two
 * openers within a campaign and nothing more — the raw address is never stored.
 * Falls back to the tracking secret as salt so this can't silently degrade to
 * an unsalted (and therefore reversible) hash of a small address space.
 */
export async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  const salt = (await getSecret("DRIP_TRACKING_SALT")) ?? (await trackingSecret());
  if (!salt) return null;
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 16);
}
