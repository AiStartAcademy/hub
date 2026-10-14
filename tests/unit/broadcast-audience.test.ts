import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

const calls = {
  contactFindMany: [] as Row[],
  contactFindUnique: [] as Row[],
  contactUpsert: [] as Row[],
  cohortFindMany: [] as Row[],
  enrollmentFindMany: [] as Row[],
  groupMemberFindMany: [] as Row[],
  paymentFindMany: [] as Row[],
  membershipFindMany: [] as Row[],
  userFindMany: [] as Row[],
  instructorFindMany: [] as Row[],
};

let leadRows: Row[] = [];
let finalContactRows: Row[] = [];
let cohorts: Row[] = [];
let enrollmentRows: Row[] = [];
let groupMemberRows: Row[] = [];
let paymentRows: Row[] = [];
let membershipRows: Row[] = [];
let allUserRows: Row[] = [];
let staffRows: Row[] = [];
let instructorRows: Row[] = [];
let contactsByEmail = new Map<string, Row>();

function normalizedEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function pageRows(rows: Row[], args: Row): Row[] {
  const take = typeof args.take === "number" ? args.take : rows.length;
  const cursor = args.cursor as { id?: string } | undefined;
  const start = cursor?.id
    ? Math.max(0, rows.findIndex((row) => row.id === cursor.id) + 1)
    : 0;
  return rows.slice(start, start + take);
}

mock.module("@/lib/prisma", () => ({
  default: {
    contact: {
      findMany: async (args: Row) => {
        calls.contactFindMany.push(args);
        const where = args.where as { email?: { in?: string[] } } | undefined;
        if (where?.email?.in) {
          const wanted = new Set(where.email.in.map(normalizedEmail));
          return finalContactRows.filter((row) => wanted.has(normalizedEmail(row.email)));
        }
        return pageRows(leadRows, args);
      },
      findUnique: async (args: Row) => {
        calls.contactFindUnique.push(args);
        const where = args.where as { email?: string };
        return contactsByEmail.get(normalizedEmail(where.email)) ?? null;
      },
      upsert: async (args: Row) => {
        calls.contactUpsert.push(args);
        const where = args.where as { email: string };
        const existing = contactsByEmail.get(normalizedEmail(where.email));
        const selected = existing ?? {
          id: `created-${normalizedEmail(where.email)}`,
          unsubscribedAt: null,
        };
        contactsByEmail.set(normalizedEmail(where.email), selected);
        return selected;
      },
    },
    cohort: {
      findMany: async (args: Row) => {
        calls.cohortFindMany.push(args);
        return cohorts;
      },
    },
    enrollment: {
      findMany: async (args: Row) => {
        calls.enrollmentFindMany.push(args);
        return enrollmentRows;
      },
    },
    groupMember: {
      findMany: async (args: Row) => {
        calls.groupMemberFindMany.push(args);
        return groupMemberRows;
      },
    },
    payment: {
      findMany: async (args: Row) => {
        calls.paymentFindMany.push(args);
        return paymentRows;
      },
    },
    membership: {
      findMany: async (args: Row) => {
        calls.membershipFindMany.push(args);
        return membershipRows;
      },
    },
    user: {
      findMany: async (args: Row) => {
        calls.userFindMany.push(args);
        const where = args.where as Row | undefined;
        return where && Object.keys(where).length === 0 ? allUserRows : staffRows;
      },
    },
    cohortInstructor: {
      findMany: async (args: Row) => {
        calls.instructorFindMany.push(args);
        return instructorRows;
      },
    },
  },
}));

const { resolveBroadcastAudience } = await import("@/lib/drip/audience");
const { countSegmentMatches } = await import("@/lib/drip/engine");

const NOW = new Date("2026-09-03T18:00:00.000Z");

function contact(
  id: string,
  email: string,
  overrides: Row = {}
): Row {
  return {
    id,
    email,
    name: email.split("@")[0],
    status: "NEW",
    source: "manual",
    tags: "[]",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    lastActivityAt: null,
    unsubscribedAt: null,
    phone: null,
    phoneConsentAt: null,
    doNotCall: false,
    smsOptOutAt: null,
    ...overrides,
  };
}

function resetFixtures(): void {
  for (const entries of Object.values(calls)) entries.length = 0;
  leadRows = [];
  finalContactRows = [];
  cohorts = [];
  enrollmentRows = [];
  groupMemberRows = [];
  paymentRows = [];
  membershipRows = [];
  allUserRows = [];
  staffRows = [];
  instructorRows = [];
  contactsByEmail = new Map();
}

describe("resolveBroadcastAudience", () => {
  beforeEach(resetFixtures);

  it("SC-3: cohorts:any unions matching leads, cohort users, group users, and paid self-paced buyers", async () => {
    leadRows = [contact("lead", "lead@example.com")];
    cohorts = [{ id: "cohort-1", slug: "spring" }];
    enrollmentRows = [
      {
        user: { email: "enrolled@example.com", name: "Enrolled" },
        cohort: { id: "cohort-1", slug: "spring" },
      },
    ];
    groupMemberRows = [
      {
        user: { email: "group@example.com", name: "Group" },
        group: { cohort: { id: "cohort-1", slug: "spring" } },
      },
    ];
    paymentRows = [
      {
        buyerEmail: "buyer@example.com",
        buyerName: "Buyer",
        user: null,
        cohort: null,
        programId: "program-1",
      },
    ];
    finalContactRows = [
      contact("lead", "lead@example.com"),
      contact("enrolled", "enrolled@example.com", { status: "WON" }),
      contact("group", "group@example.com", { status: "WON" }),
      contact("buyer", "buyer@example.com", { status: "WON" }),
    ];

    const result = await resolveBroadcastAudience(
      { sources: ["manual"], cohorts: "any" },
      { now: NOW }
    );

    expect(result.contactIds).toEqual(["lead", "enrolled", "group", "buyer"]);
    expect(calls.enrollmentFindMany).toHaveLength(1);
    expect(calls.groupMemberFindMany).toHaveLength(1);
    expect(calls.paymentFindMany[0]).toMatchObject({ where: { status: "paid" } });
  });

  it("SC-4: dedupes case-insensitively and counts each cross-source duplicate removed", async () => {
    leadRows = [contact("alice", "Alice@Example.com")];
    cohorts = [{ id: "cohort-1", slug: "spring" }];
    enrollmentRows = [
      {
        user: { email: " alice@example.com ", name: "Alice" },
        cohort: { id: "cohort-1", slug: "spring" },
      },
    ];
    paymentRows = [
      {
        buyerEmail: "ALICE@EXAMPLE.COM",
        buyerName: "Alice",
        user: null,
        cohort: null,
        programId: "program-1",
      },
    ];
    finalContactRows = [contact("alice", "alice@example.com")];

    const result = await resolveBroadcastAudience(
      { sources: ["manual"], cohorts: "any" },
      { now: NOW }
    );

    expect(result.contactIds).toEqual(["alice"]);
    expect(result.counts).toEqual({ leads: 1, users: 1, buyers: 1, dedup: 2, suppressed: 0 });
  });

  it("SC-5: suppresses management roles, cohort instructors, unsubscribes, and no-drip tags after union", async () => {
    cohorts = [{ id: "cohort-1", slug: "spring" }];
    enrollmentRows = [
      { user: { email: "manager@example.com", name: "Manager" }, cohort: cohorts[0] },
      { user: { email: "unsub@example.com", name: "Unsub" }, cohort: cohorts[0] },
    ];
    groupMemberRows = [
      {
        user: { email: "instructor@example.com", name: "Instructor" },
        group: { cohort: cohorts[0] },
      },
    ];
    paymentRows = [
      {
        buyerEmail: "blocked@example.com",
        buyerName: "Blocked",
        user: null,
        cohort: null,
        programId: "program-1",
      },
      {
        buyerEmail: "ok@example.com",
        buyerName: "OK",
        user: null,
        cohort: null,
        programId: "program-1",
      },
    ];
    staffRows = [
      { email: "manager@example.com", role: "STUDENT", roles: '["ADMIN"]' },
    ];
    instructorRows = [{ instructor: { email: "instructor@example.com" } }];
    finalContactRows = [
      contact("manager", "manager@example.com"),
      contact("instructor", "instructor@example.com"),
      contact("unsub", "unsub@example.com", { unsubscribedAt: NOW }),
      contact("blocked", "blocked@example.com", { tags: '["customer","no-drip"]' }),
      contact("ok", "ok@example.com"),
    ];

    const result = await resolveBroadcastAudience({ cohorts: "any" }, { now: NOW });

    expect(result.contactIds).toEqual(["ok"]);
    expect(result.counts.suppressed).toBe(4);
  });

  it("SC-1: newly provisioned Contacts start at NEW rather than WON", async () => {
    cohorts = [{ id: "cohort-1", slug: "spring" }];
    enrollmentRows = [
      {
        user: { email: "new@example.com", name: "  New User  " },
        cohort: { id: "cohort-1", slug: "spring" },
      },
      {
        user: { email: "existing@example.com", name: "Replacement Name" },
        cohort: { id: "cohort-1", slug: "spring" },
      },
    ];
    contactsByEmail.set("existing@example.com", {
      id: "existing",
      tags: '["customer"]',
      unsubscribedAt: null,
    });
    finalContactRows = [
      contact("created-new@example.com", "new@example.com", {
        status: "NEW",
        source: "broadcast-audience",
        tags: '["cohort:spring"]',
      }),
      contact("existing", "existing@example.com", {
        name: "Original Name",
        status: "QUALIFIED",
        source: "onboarding:agency",
        tags: '["customer","cohort:spring"]',
      }),
    ];

    const result = await resolveBroadcastAudience({ cohorts: "any" }, { now: NOW });

    expect(result.contactIds).toEqual(["created-new@example.com", "existing"]);
    const createCall = calls.contactUpsert.find((call) =>
      JSON.stringify(call).includes("new@example.com")
    );
    expect(createCall).toMatchObject({
      update: { tags: '["cohort:spring"]', lastActivityAt: NOW },
      create: {
        email: "new@example.com",
        name: "New User",
        status: "NEW",
        source: "broadcast-audience",
        tags: '["cohort:spring"]',
        lastActivityAt: NOW,
      },
    });
    const updateCall = calls.contactUpsert.find((call) =>
      JSON.stringify(call).includes("existing@example.com")
    );
    expect(updateCall?.update).toEqual({
      tags: '["customer","cohort:spring"]',
      lastActivityAt: NOW,
    });
  });

  it("SC-3: existing Contacts receive tags without rewriting status, source, or name", async () => {
    cohorts = [{ id: "cohort-1", slug: "spring" }];
    enrollmentRows = [
      {
        user: { email: "existing@example.com", name: "Replacement Name" },
        cohort: { id: "cohort-1", slug: "spring" },
      },
    ];
    contactsByEmail.set("existing@example.com", {
      id: "existing",
      tags: '["customer"]',
      unsubscribedAt: null,
    });
    finalContactRows = [
      contact("existing", "existing@example.com", {
        name: "Original Name",
        status: "QUALIFIED",
        source: "onboarding:agency",
        tags: '["customer","cohort:spring"]',
      }),
    ];

    await resolveBroadcastAudience({ cohorts: "any" }, { now: NOW });

    expect(calls.contactUpsert).toHaveLength(1);
    expect(calls.contactUpsert[0]?.update).toEqual({
      tags: '["customer","cohort:spring"]',
      lastActivityAt: NOW,
    });
    expect(calls.contactUpsert[0]?.update).not.toHaveProperty("status");
    expect(calls.contactUpsert[0]?.update).not.toHaveProperty("source");
    expect(calls.contactUpsert[0]?.update).not.toHaveProperty("name");
  });

  it("SC-5: broadcast provisioning leaves a hub user's Contact out of WON", async () => {
    allUserRows = [{ id: "user-1", email: "hub@example.com", name: "Hub User" }];
    finalContactRows = [
      contact("created-hub@example.com", "hub@example.com", {
        status: "NEW",
        source: "broadcast-audience",
        tags: '["broadcast:user"]',
      }),
    ];

    const result = await resolveBroadcastAudience({ includeUsers: true }, { now: NOW });

    expect(result.contactIds).toEqual(["created-hub@example.com"]);
    expect(calls.contactUpsert[0]?.create).toMatchObject({
      email: "hub@example.com",
      status: "NEW",
      source: "broadcast-audience",
    });
    expect(calls.contactUpsert[0]?.create).not.toMatchObject({ status: "WON" });
  });

  it("SC-7: reports source uniques, duplicate removals, and final suppressions precisely", async () => {
    leadRows = [
      contact("alice", "alice@example.com"),
      contact("blocked", "blocked@example.com", { tags: '["no-drip"]' }),
    ];
    cohorts = [{ id: "cohort-1", slug: "spring" }];
    enrollmentRows = [
      { user: { email: "ALICE@example.com", name: "Alice" }, cohort: cohorts[0] },
      { user: { email: "user@example.com", name: "User" }, cohort: cohorts[0] },
    ];
    paymentRows = [
      { buyerEmail: "alice@example.com", buyerName: "Alice", user: null, programId: "p1" },
      { buyerEmail: "buyer@example.com", buyerName: "Buyer", user: null, programId: "p2" },
    ];
    finalContactRows = [
      contact("alice", "alice@example.com"),
      contact("blocked", "blocked@example.com", { tags: '["no-drip"]' }),
      contact("user", "user@example.com"),
      contact("buyer", "buyer@example.com"),
    ];

    const result = await resolveBroadcastAudience(
      { sources: ["manual"], cohorts: "any" },
      { now: NOW }
    );

    expect(result.counts).toEqual({ leads: 2, users: 2, buyers: 2, dedup: 2, suppressed: 1 });
    expect(result.contactIds).toEqual(["alice", "user", "buyer"]);
  });

  it("SC-3: maps explicit self-paced products to paid program Payments and membership products to active Memberships", async () => {
    paymentRows = [
      { buyerEmail: "course@example.com", buyerName: "Course", user: null, programId: "p1" },
    ];
    membershipRows = [
      { buyerEmail: "member@example.com", buyerName: "Member", user: null },
    ];
    finalContactRows = [
      contact("course", "course@example.com"),
      contact("member", "member@example.com"),
    ];

    const result = await resolveBroadcastAudience(
      { products: ["self-paced", "membership"] },
      { now: NOW }
    );

    expect(result.contactIds).toEqual(["course", "member"]);
    expect(calls.paymentFindMany[0]).toMatchObject({
      where: { status: "paid", programId: { not: null } },
    });
    expect(calls.membershipFindMany[0]).toMatchObject({ where: { status: "active" } });
  });
});

describe("countSegmentMatches", () => {
  beforeEach(resetFixtures);

  it("SC-8: paginates beyond 5000 candidates for broadcast-aware previews", async () => {
    leadRows = Array.from({ length: 5001 }, (_, index) =>
      contact(`contact-${String(index).padStart(4, "0")}`, `lead-${index}@example.com`)
    );
    finalContactRows = leadRows;

    const count = await countSegmentMatches(
      { sources: ["manual"], includeUsers: true },
      NOW
    );

    expect(count).toBe(5001);
    const leadPageCalls = calls.contactFindMany.filter((call) => {
      const where = call.where as { email?: unknown } | undefined;
      return !where?.email;
    });
    expect(leadPageCalls.length).toBeGreaterThan(1);
    expect(leadPageCalls.every((call) => call.take !== 5000)).toBe(true);
  });
});
