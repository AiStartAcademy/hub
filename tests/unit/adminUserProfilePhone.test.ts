import { beforeEach, describe, expect, it, mock } from "bun:test";

type SessionState = { user: { id: string; role?: string; roles?: string[] } } | null;

const USER_ID = "user-1";
const CONSENT_AT = new Date("2026-09-01T12:00:00.000Z");
const STOP_AT = new Date("2026-09-02T12:00:00.000Z");
const PHONE = "+14155550123";
const NEW_PHONE = "+14155550124";

let session: SessionState = null;

type ContactRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  birthday: string | null;
  phoneConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
  userId: string | null;
  linkSource: string | null;
};

let contact: ContactRow | null = null;
let contactUpdateError: Error | null = null;
const contactUpdates: { where: unknown; data: Record<string, unknown> }[] = [];
const contactEvents: Record<string, unknown>[] = [];

const userProfileRow = {
  id: USER_ID,
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
  bio: null,
  role: "STUDENT",
  timezone: "UTC",
  createdAt: CONSENT_AT,
  headline: null,
  location: null,
  languages: null,
  socialLinks: null,
  expertiseTags: null,
  isMentor: false,
  profileVisibility: "PRIVATE",
  slug: null,
  portfolioItems: [],
  profileVideos: [],
  testimonials: [],
  reviews: [],
  _count: { taughtCohorts: 0 },
};

const noop = { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) };

const prismaMock = {
  user: {
    findUnique: async () => ({ ...userProfileRow }),
    update: async () => ({ id: USER_ID }),
  },
  contact: {
    findFirst: async (): Promise<ContactRow | null> => (contact ? { ...contact } : null),
    findUnique: async (): Promise<ContactRow | null> => (contact ? { ...contact } : null),
    update: async (args: { where: unknown; data: Record<string, unknown> }) => {
      if (contactUpdateError) throw contactUpdateError;
      contactUpdates.push(args);
      contact = { ...(contact as ContactRow), ...args.data };
      return { ...contact };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      contact = { ...(args.data as unknown as ContactRow), id: "contact-created" };
      return { ...contact };
    },
  },
  contactEvent: {
    create: async (args: { data: Record<string, unknown> }) => {
      contactEvents.push(args.data);
      return {};
    },
  },
  enrollment: { count: async () => 0 },
  payment: { count: async () => 0 },
  portfolioItem: noop,
  profileVideo: noop,
  testimonial: noop,
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};

const actualPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({ ...actualPrisma, default: prismaMock }));

const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: async () => session,
  canViewUserData: (s: SessionState) => s?.user?.role === "ADMIN",
  canEditUserData: (s: SessionState) => s?.user?.role === "ADMIN",
}));

const route = await import("@/app/api/admin/users/[userId]/profile/route");

function params() {
  return { params: Promise.resolve({ userId: USER_ID }) };
}

function get(): Promise<Response> {
  return route.GET(
    new Request("https://hub.example/api/admin/users/user-1/profile"),
    params()
  );
}

function patch(body: Record<string, unknown>): Promise<Response> {
  return route.PATCH(
    new Request("https://hub.example/api/admin/users/user-1/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params()
  );
}

beforeEach(() => {
  session = { user: { id: "admin-1", role: "ADMIN", roles: ["ADMIN"] } };
  contactUpdates.length = 0;
  contactEvents.length = 0;
  contactUpdateError = null;
  contact = {
    id: "contact-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    phone: PHONE,
    birthday: null,
    phoneConsentAt: CONSENT_AT,
    smsOptOutAt: STOP_AT,
    doNotCall: true,
    userId: USER_ID,
    linkSource: "auto_email",
  };
});

describe("admin user profile — personContact", () => {
  it("SC-25: GET returns a personContact block with phone and all three consent fields", async () => {
    const response = await get();
    expect(response.status).toBe(200);

    const body = (await response.json()) as { personContact: Record<string, unknown> };
    expect(body.personContact).toMatchObject({ phone: PHONE, doNotCall: true });
    expect(body.personContact.phoneConsentAt).toBeTruthy();
    expect(body.personContact.smsOptOutAt).toBeTruthy();
  });

  it("SC-25: GET returns an empty personContact when the user has no linked Contact", async () => {
    contact = null;
    const body = (await (await get()).json()) as { personContact: Record<string, unknown> };
    expect(body.personContact).toEqual({
      phone: null,
      phoneConsentAt: null,
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      smsOptOutAt: null,
      doNotCall: false,
    });
  });

  it("SC-26: PATCH routes a phone edit through setPersonPhone and audits the actor as admin", async () => {
    const oldNumberConsentAt = new Date("2026-08-01T00:00:00.000Z");
    contact = {
      ...(contact as ContactRow),
      phoneConsentAt: null,
      // Text consent the person gave for the OLD number.
      smsMarketingConsentAt: oldNumberConsentAt,
      smsTransactionalConsentAt: oldNumberConsentAt,
      smsOptOutAt: null,
      doNotCall: false,
    } as ContactRow;

    // The SMS flags are smuggled in on purpose: an admin may record call
    // consent, but may never grant text consent on someone else's behalf.
    const response = await patch({
      phone: NEW_PHONE,
      callConsent: true,
      smsMarketingConsent: true,
      smsTransactionalConsent: true,
    });
    expect(response.status).toBe(200);

    expect(contactUpdates).toHaveLength(1);
    expect(contactUpdates[0].data.phone).toBe(NEW_PHONE);
    expect(contactUpdates[0].data.phoneConsentAt).toBeInstanceOf(Date);
    // The number changed under an admin: SMS consent given for the old number
    // is dropped, and the smuggled flags never become a grant.
    expect(contactUpdates[0].data.smsMarketingConsentAt).toBeNull();
    expect(contactUpdates[0].data.smsTransactionalConsentAt).toBeNull();

    // setPersonPhone's consent audit rows record who did it: call consent
    // granted, and both text consents withdrawn with the old number.
    const audit = contactEvents.map(
      (event) => JSON.parse(String(event.metadata)) as Record<string, string>
    );
    expect(audit).toHaveLength(3);
    for (const row of audit) expect(row.source).toBe("admin");
    expect(audit.find((row) => row.kind === "calls")?.action).toBe("granted");
    expect(audit.find((row) => row.kind === "sms_marketing")?.action).toBe("withdrawn");
    expect(audit.find((row) => row.kind === "sms_transactional")?.action).toBe("withdrawn");
  });

  it("SC-27: PATCH maps InvalidPhoneError to 400 and leaves other failures at 500", async () => {
    const bad = await patch({ phone: "nonsense" });
    expect(bad.status).toBe(400);
    expect(contactUpdates).toHaveLength(0);

    contactUpdateError = new Error("database is on fire");
    const boom = await patch({ phone: NEW_PHONE, callConsent: false });
    expect(boom.status).toBe(500);
  });

  it("SC-28: an admin cannot clear smsOptOutAt or doNotCall from this surface", async () => {
    const response = await patch({
      phone: NEW_PHONE,
      callConsent: true,
      smsOptOutAt: null,
      doNotCall: false,
    });
    expect(response.status).toBe(200);

    // Neither field is ever written, whatever the body claims.
    for (const update of contactUpdates) {
      expect(update.data).not.toHaveProperty("smsOptOutAt");
      expect(update.data).not.toHaveProperty("doNotCall");
    }

    const body = (await response.json()) as { personContact: Record<string, unknown> };
    expect(body.personContact.smsOptOutAt).toBeTruthy();
    expect(body.personContact.doNotCall).toBe(true);
  });
});
