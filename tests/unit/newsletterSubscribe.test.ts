// tests/unit/newsletterSubscribe.test.ts
//
// Covers the public newsletter signup route. The behaviours asserted here are
// the ones that are expensive to get wrong in production:
//   · consent is mandatory and never manufactured,
//   · first-touch `source` and `attribution` survive a re-subscribe,
//   · a deliberate re-signup clears a previous unsubscribe,
//   · a mail failure never loses the subscription.
import { beforeEach, describe, expect, it, mock } from "bun:test";

// bun's mock registry is process-wide; @/lib/mail is imported by other suites,
// so spread the real module rather than replacing it wholesale.
mock.module("server-only", () => ({}));

// autoLinkContact is deliberately NOT mocked. bun's mock registry is
// process-wide and has no unmock, so stubbing @/lib/leads/linking here silently
// replaced it for tests/unit/leadLinking.test.ts too. The route fires it
// best-effort against the prisma double below and swallows any rejection, which
// is exactly the production contract we want covered.

type ContactRecord = {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  status: string | null;
  tags: string | null;
  attribution: string | null;
  unsubscribedAt: Date | null;
  phone: string | null;
  phoneConsentAt: Date | null;
};

type Captured = { where?: unknown; data: Record<string, unknown> };

const contacts = new Map<string, ContactRecord>();
const created: Captured[] = [];
const updated: Captured[] = [];
const events: Array<Record<string, unknown>> = [];
const mails: Array<{ to: string; subject: string }> = [];
let mailShouldThrow = false;

mock.module("@/lib/prisma", () => ({
  default: {
    contact: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        contacts.get(where.email) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ data });
        const record = {
          id: `contact-${created.length}`,
          phone: null,
          phoneConsentAt: null,
          ...data,
        } as ContactRecord;
        contacts.set(record.email, record);
        return record;
      },
      update: async ({ where, data }: { where: { email: string }; data: Record<string, unknown> }) => {
        updated.push({ where, data });
        const existing = contacts.get(where.email);
        const record = { ...(existing as ContactRecord), ...data } as ContactRecord;
        contacts.set(where.email, record);
        return record;
      },
    },
    contactEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return { id: `event-${events.length}`, ...data };
      },
    },
  },
}));

const actualMail = await import("@/lib/mail");
mock.module("@/lib/mail", () => ({
  ...actualMail,
  sendMail: async ({ to, subject }: { to: string; subject: string }) => {
    if (mailShouldThrow) throw new Error("smtp down");
    mails.push({ to, subject });
  },
}));

let cookieJar: Record<string, string> = {};
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar[name] !== undefined ? { name, value: cookieJar[name] } : undefined,
  }),
}));

const { POST } = await import("@/app/api/public/newsletter/subscribe/route");

let ipCounter = 0;

function request(
  body: unknown,
  options: { ip?: string } = {},
): Promise<Response> {
  // A fresh IP per call by default: the limiter is a process-wide in-memory
  // map, so a shared key would make unrelated cases bleed into each other.
  const ip = options.ip ?? `10.0.0.${(ipCounter += 1)}`;
  return POST(
    new Request("https://hub.example/api/public/newsletter/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

function tagsOf(email: string): string[] {
  const raw = contacts.get(email)?.tags;
  return raw ? (JSON.parse(raw) as string[]) : [];
}

beforeEach(() => {
  contacts.clear();
  created.length = 0;
  updated.length = 0;
  events.length = 0;
  mails.length = 0;
  cookieJar = {};
  mailShouldThrow = false;
});

describe("POST /api/public/newsletter/subscribe", () => {
  it("creates a newsletter contact and sends the welcome email", async () => {
    const response = await request({
      email: "  New@Example.COM ",
      name: "Ada",
      consent: true,
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(created).toHaveLength(1);
    const contact = created[0]!.data;
    // Email is normalized so the unique constraint can't be bypassed by casing.
    expect(contact.email).toBe("new@example.com");
    expect(contact.name).toBe("Ada");
    expect(contact.source).toBe("newsletter");
    expect(contact.status).toBe("NEW");
    expect(JSON.parse(contact.tags as string)).toEqual(["newsletter"]);
    // No consent disclosure on this form — it must not manufacture phone consent.
    expect(contact.phoneConsentAt).toBeUndefined();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("NEWSLETTER_SUBSCRIBE");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("new@example.com");
  });

  it("merges the tag onto an existing contact without rewriting first-touch source", async () => {
    contacts.set("known@example.com", {
      id: "contact-existing",
      email: "known@example.com",
      name: "Grace",
      source: "onboarding:ai-path",
      status: "CONTACTED",
      tags: JSON.stringify(["goal-agency"]),
      attribution: JSON.stringify({ utmSource: "meta" }),
      unsubscribedAt: null,
      phone: "+14155550123",
      phoneConsentAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const response = await request({ email: "known@example.com", consent: true });

    expect(response.status).toBe(201);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);

    const data = updated[0]!.data;
    expect(data.source).toBeUndefined();
    expect(data.attribution).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.phone).toBeUndefined();
    expect(data.phoneConsentAt).toBeUndefined();
    expect(tagsOf("known@example.com")).toEqual(["goal-agency", "newsletter"]);
  });

  it("clears a previous unsubscribe when someone deliberately re-subscribes", async () => {
    contacts.set("back@example.com", {
      id: "contact-back",
      email: "back@example.com",
      name: "Linus",
      source: "asset_download",
      status: "NEW",
      tags: JSON.stringify(["newsletter"]),
      attribution: null,
      unsubscribedAt: new Date("2026-05-01T00:00:00.000Z"),
      phone: null,
      phoneConsentAt: null,
    });

    const response = await request({ email: "back@example.com", consent: true });

    expect(response.status).toBe(201);
    expect(updated[0]!.data.unsubscribedAt).toBeNull();
    // Already tagged — the tag list must stay de-duplicated.
    expect(tagsOf("back@example.com")).toEqual(["newsletter"]);
  });

  it("rejects a submission without consent and writes nothing", async () => {
    const missing = await request({ email: "nope@example.com" });
    const explicitlyFalse = await request({ email: "nope@example.com", consent: false });

    expect(missing.status).toBe(400);
    expect(explicitlyFalse.status).toBe(400);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it("rejects an invalid email", async () => {
    const response = await request({ email: "not-an-email", consent: true });

    expect(response.status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it("stores first-touch attribution on create and leaves it alone on re-subscribe", async () => {
    cookieJar["aisa_attribution"] = JSON.stringify({
      utm_source: "linkedin",
      utm_medium: "social",
      utm_campaign: "launch",
    });

    await request({ email: "utm@example.com", consent: true });

    const attribution = JSON.parse(created[0]!.data.attribution as string);
    expect(attribution.utmSource).toBe("linkedin");
    expect(attribution.utmMedium).toBe("social");
    expect(events[0]!.utmSource).toBe("linkedin");
    expect(events[0]!.utmCampaign).toBe("launch");

    // Second touch from a different campaign must not overwrite the first.
    cookieJar["aisa_attribution"] = JSON.stringify({ utm_source: "google" });
    await request({ email: "utm@example.com", consent: true });

    expect(updated[0]!.data.attribution).toBeUndefined();
  });

  it("keeps the subscription when the welcome email fails", async () => {
    mailShouldThrow = true;

    const response = await request({ email: "smtp@example.com", consent: true });

    expect(response.status).toBe(201);
    expect(created).toHaveLength(1);
    expect(mails).toHaveLength(0);
  });

  it("rate-limits repeated submissions from one IP", async () => {
    const ip = "203.0.113.9";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const allowed = await request({ email: `burst${attempt}@example.com`, consent: true }, { ip });
      expect(allowed.status).toBe(201);
    }

    const blocked = await request({ email: "burst-over@example.com", consent: true }, { ip });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});
