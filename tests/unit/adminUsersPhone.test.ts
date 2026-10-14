import { beforeEach, describe, expect, it, mock } from "bun:test";

type SessionState = { user: { id: string; role?: string; roles?: string[] } } | null;

type ContactRow = {
  id: string;
  email: string;
  userId: string | null;
  phone: string | null;
  phoneConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
  createdAt: Date;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  roles: string[];
  image: string | null;
  createdAt: Date;
};

const CONSENT_AT = new Date("2026-09-01T12:00:00.000Z");
const STOP_AT = new Date("2026-09-02T12:00:00.000Z");

const MATCHING_PHONE = "+15550001111";
const OLDER_PHONE = "+15550002222";
const SECOND_USER_PHONE = "+15550003333";

let session: SessionState = null;

const users: UserRow[] = [
  {
    id: "user-1",
    name: "Ada Lovelace",
    email: "Ada@Example.com",
    role: "STUDENT",
    roles: ["STUDENT"],
    image: null,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  },
  {
    id: "user-2",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "STUDENT",
    roles: ["STUDENT"],
    image: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "user-3",
    name: "No Contact",
    email: "nobody@example.com",
    role: "STUDENT",
    roles: ["STUDENT"],
    image: null,
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
  },
];

/**
 * user-1 has TWO Contacts — Contact.userId is deliberately non-unique. The
 * older one does NOT match the user's email; the newer one does. The
 * email-matching row must win.
 */
const contacts: ContactRow[] = [
  {
    id: "contact-old",
    email: "ada.old@example.com",
    userId: "user-1",
    phone: OLDER_PHONE,
    phoneConsentAt: null,
    smsOptOutAt: null,
    doNotCall: true,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
  },
  {
    id: "contact-match",
    email: "ada@example.com",
    userId: "user-1",
    phone: MATCHING_PHONE,
    phoneConsentAt: CONSENT_AT,
    smsOptOutAt: STOP_AT,
    doNotCall: false,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
  },
  {
    id: "contact-grace",
    email: "grace.alt@example.com",
    userId: "user-2",
    phone: SECOND_USER_PHONE,
    phoneConsentAt: CONSENT_AT,
    smsOptOutAt: null,
    doNotCall: false,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
  },
];

const contactFindManyCalls: { where: Record<string, unknown> }[] = [];

const prismaMock = {
  user: {
    findMany: async (): Promise<UserRow[]> => users.map((u) => ({ ...u })),
  },
  contact: {
    findMany: async (args: { where: Record<string, unknown> }): Promise<ContactRow[]> => {
      contactFindManyCalls.push(args);
      const filter = args.where.userId as { in?: string[] } | undefined;
      const ids = filter?.in ?? [];
      return contacts.filter((c) => c.userId !== null && ids.includes(c.userId)).map((c) => ({ ...c }));
    },
  },
};

const actualPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({ ...actualPrisma, default: prismaMock }));

const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({ ...actualAuth, auth: async () => session }));

const { GET } = await import("@/app/api/admin/users/route");

beforeEach(() => {
  contactFindManyCalls.length = 0;
  session = { user: { id: "admin-1", role: "ADMIN", roles: ["ADMIN"] } };
});

describe("GET /api/admin/users — linked Contact phone + consent", () => {
  it("SC-21: joins the linked Contact's phone and all three consent fields in one batched query", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>[];
    const byId = new Map(body.map((row) => [row.id as string, row]));

    // Deterministic pick: the Contact whose email matches the user's wins over
    // an older, non-matching one.
    expect(byId.get("user-1")).toMatchObject({
      phone: MATCHING_PHONE,
      doNotCall: false,
    });
    expect(byId.get("user-1")?.phoneConsentAt).toBeTruthy();
    expect(byId.get("user-1")?.smsOptOutAt).toBeTruthy();

    // No email match — the single linked Contact still supplies the state.
    expect(byId.get("user-2")).toMatchObject({
      phone: SECOND_USER_PHONE,
      smsOptOutAt: null,
      doNotCall: false,
    });

    // No linked Contact at all — every field present, never undefined.
    expect(byId.get("user-3")).toMatchObject({
      phone: null,
      phoneConsentAt: null,
      smsOptOutAt: null,
      doNotCall: false,
    });

    // One batched query, never one per user (no N+1).
    expect(contactFindManyCalls).toHaveLength(1);
  });

  it("SC-22: a non-ADMIN request is rejected and no phone appears anywhere in the payload", async () => {
    for (const nonAdmin of [null, { user: { id: "u", role: "STUDENT", roles: ["STUDENT"] } }, { user: { id: "i", role: "INSTRUCTOR", roles: ["INSTRUCTOR", "TEAM_MEMBER"] } }]) {
      session = nonAdmin as SessionState;
      const response = await GET();

      expect(response.status).toBe(401);
      const raw = await response.text();
      for (const phone of [MATCHING_PHONE, OLDER_PHONE, SECOND_USER_PHONE]) {
        expect(raw).not.toContain(phone);
      }
      expect(raw).not.toContain("phoneConsentAt");
      // The contact table must not even be read for an unauthorized caller.
      expect(contactFindManyCalls).toHaveLength(0);
    }
  });
});
