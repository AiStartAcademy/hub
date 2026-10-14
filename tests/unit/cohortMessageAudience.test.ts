import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

const NOW = new Date("2026-10-06T18:00:00.000Z");

let cohortRow: Row | null;
let enrollmentRows: Row[];
let contacts: Map<string, Row>;
const calls = {
  enrollmentFindMany: [] as Row[],
  contactFindMany: [] as Row[],
  contactUpsert: [] as Row[],
  contactUpdate: [] as Row[],
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function pageRows(rows: Row[], args: Row): Row[] {
  const take = typeof args.take === "number" ? args.take : rows.length;
  const cursor = args.cursor as { id?: string } | undefined;
  const start = cursor?.id ? rows.findIndex((row) => row.id === cursor.id) + 1 : 0;
  return rows.slice(start, start + take);
}

function contactRow(email: string, overrides: Row = {}): Row {
  return {
    id: `contact-${email}`,
    email,
    name: null,
    tags: "[]",
    unsubscribedAt: null,
    courseEmailOptOutAt: null,
    phone: "+14155550100",
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: NOW,
    smsOptOutAt: null,
    ...overrides,
  };
}

function user(email: string, overrides: Row = {}): Row {
  return { email, name: email.split("@")[0], role: "STUDENT", roles: "[]", ...overrides };
}

function enrollment(id: string, userRow: Row, status = "active"): Row {
  return { id, status, user: userRow };
}

const prismaMock = {
  cohort: {
    findUnique: async () => cohortRow,
  },
  enrollment: {
    findMany: async (args: Row) => {
      calls.enrollmentFindMany.push(args);
      const where = args.where as { status?: { not?: string } };
      const visible = enrollmentRows.filter(
        (row) => !where.status?.not || row.status !== where.status.not
      );
      return pageRows(visible, args);
    },
  },
  contact: {
    findMany: async (args: Row) => {
      calls.contactFindMany.push(args);
      const wanted = new Set(
        ((args.where as { email: { in: string[] } }).email.in ?? []).map(normalized)
      );
      return [...contacts.values()].filter((row) => wanted.has(normalized(row.email)));
    },
    findUnique: async (args: Row) =>
      contacts.get(normalized((args.where as { email: string }).email)) ?? null,
    upsert: async (args: Row) => {
      calls.contactUpsert.push(args);
      const email = normalized((args.where as { email: string }).email);
      const existing = contacts.get(email);
      if (existing) return existing;
      const created = contactRow(email, {
        id: `created-${email}`,
        phone: null,
        smsTransactionalConsentAt: null,
      });
      contacts.set(email, created);
      return created;
    },
    update: async (args: Row) => {
      calls.contactUpdate.push(args);
      return args;
    },
  },
};

const realPrisma = await import("@/lib/prisma");
mock.module("@/lib/prisma", () => ({ ...realPrisma, default: prismaMock }));
afterAll(() => {
  mock.module("@/lib/prisma", () => realPrisma);
});

const { resolveCohortMessageAudience } = await import("@/lib/cohortMessages/audience");

beforeEach(() => {
  cohortRow = { id: "cohort-1", slug: "fall-2026", title: "Fall 2026", instructors: [] };
  enrollmentRows = [];
  contacts = new Map();
  calls.enrollmentFindMany = [];
  calls.contactFindMany = [];
  calls.contactUpsert = [];
  calls.contactUpdate = [];
});

describe("resolveCohortMessageAudience", () => {
  it("SC-1: includes every non-dropped enrollment, creates missing Contacts, dedupes by normalized email", async () => {
    contacts.set("ann@example.com", contactRow("ann@example.com"));
    enrollmentRows = [
      enrollment("e1", user("Ann@Example.com", { name: "Ann Lee" })),
      enrollment("e2", user("bob@example.com", { name: "Bob" }), "completed"),
      enrollment("e3", user("carl@example.com"), "dropped"),
      enrollment("e4", user(" ann@example.com ", { name: "Ann Again" })),
    ];

    const audience = await resolveCohortMessageAudience("cohort-1", {
      includeInstructors: false,
      ensureContacts: true,
      now: NOW,
    });

    expect(audience).not.toBeNull();
    expect(audience!.recipients.map((r) => r.email).sort()).toEqual([
      "ann@example.com",
      "bob@example.com",
    ]);
    expect(calls.enrollmentFindMany[0]?.where).toEqual({
      cohortId: "cohort-1",
      status: { not: "dropped" },
    });
    // Only the person without a Contact is provisioned; existing rows are untouched.
    expect(calls.contactUpsert).toHaveLength(1);
    expect((calls.contactUpsert[0]?.where as Row).email).toBe("bob@example.com");
    const bob = audience!.recipients.find((r) => r.email === "bob@example.com");
    expect(bob?.contactId).toBe("created-bob@example.com");
    expect(audience!.recipients.find((r) => r.email === "ann@example.com")?.name).toBe("Ann Lee");
  });

  it("SC-1: paginates enrollments instead of loading the cohort in one unbounded read", async () => {
    enrollmentRows = Array.from({ length: 1_203 }, (_, index) =>
      enrollment(`e${String(index).padStart(5, "0")}`, user(`s${index}@example.com`))
    );
    for (const row of enrollmentRows) {
      const email = normalized((row.user as Row).email);
      contacts.set(email, contactRow(email));
    }

    const audience = await resolveCohortMessageAudience("cohort-1", {
      includeInstructors: false,
      ensureContacts: true,
      now: NOW,
    });

    expect(audience!.recipients).toHaveLength(1_203);
    expect(calls.enrollmentFindMany.length).toBeGreaterThan(1);
    for (const args of calls.enrollmentFindMany) expect(typeof args.take).toBe("number");
    for (const args of calls.contactFindMany) {
      expect(((args.where as { email: { in: string[] } }).email.in).length).toBeLessThanOrEqual(500);
    }
  });

  it("SC-1: preview mode reads only — no Contact is created for a person without one", async () => {
    enrollmentRows = [enrollment("e1", user("new@example.com"))];

    const audience = await resolveCohortMessageAudience("cohort-1", {
      includeInstructors: false,
      ensureContacts: false,
      now: NOW,
    });

    expect(calls.contactUpsert).toHaveLength(0);
    expect(calls.contactUpdate).toHaveLength(0);
    expect(audience!.recipients).toEqual([
      expect.objectContaining({
        contactId: null,
        email: "new@example.com",
        emailReason: null,
        smsReason: "no_sms_transactional_consent",
      }),
    ]);
  });

  it("SC-1: returns null for an unknown cohort", async () => {
    cohortRow = null;
    expect(
      await resolveCohortMessageAudience("missing", { includeInstructors: true, ensureContacts: false })
    ).toBeNull();
  });

  it("SC-2: instructors only with includeInstructors; ADMIN and TEAM_MEMBER never", async () => {
    cohortRow = {
      id: "cohort-1",
      slug: "fall-2026",
      title: "Fall 2026",
      instructors: [
        user("teacher@example.com", { role: "INSTRUCTOR", roles: '["INSTRUCTOR"]' }),
        user("lex@example.com", { role: "ADMIN", roles: '["ADMIN","INSTRUCTOR"]' }),
      ],
    };
    enrollmentRows = [
      enrollment("e1", user("student@example.com")),
      enrollment("e2", user("ops@example.com", { role: "TEAM_MEMBER", roles: '["TEAM_MEMBER"]' })),
      enrollment("e3", user("admin@example.com", { role: "STUDENT", roles: '["STUDENT","ADMIN"]' })),
      enrollment("e4", user("staff-student@example.com", { role: "INSTRUCTOR", roles: "[]" })),
    ];
    for (const email of [
      "student@example.com",
      "teacher@example.com",
      "lex@example.com",
      "ops@example.com",
      "admin@example.com",
      "staff-student@example.com",
    ]) {
      contacts.set(email, contactRow(email));
    }

    const without = await resolveCohortMessageAudience("cohort-1", {
      includeInstructors: false,
      ensureContacts: true,
      now: NOW,
    });
    expect(without!.recipients.map((r) => r.email)).toEqual(["student@example.com"]);

    const withInstructors = await resolveCohortMessageAudience("cohort-1", {
      includeInstructors: true,
      ensureContacts: true,
      now: NOW,
    });
    expect(withInstructors!.recipients.map((r) => r.email).sort()).toEqual([
      "staff-student@example.com",
      "student@example.com",
      "teacher@example.com",
    ]);
    expect(withInstructors!.recipients.find((r) => r.email === "teacher@example.com")?.kind).toBe(
      "instructor"
    );
  });

  it("SC-3: course opt-out is the email reason; marketing unsubscribe does not exclude", async () => {
    enrollmentRows = [
      enrollment("e1", user("course-off@example.com")),
      enrollment("e2", user("marketing-off@example.com")),
    ];
    contacts.set(
      "course-off@example.com",
      contactRow("course-off@example.com", { courseEmailOptOutAt: NOW })
    );
    contacts.set(
      "marketing-off@example.com",
      contactRow("marketing-off@example.com", { unsubscribedAt: NOW })
    );

    const audience = await resolveCohortMessageAudience("cohort-1", {
      includeInstructors: false,
      ensureContacts: true,
      now: NOW,
    });
    const byEmail = new Map(audience!.recipients.map((r) => [r.email, r]));
    expect(byEmail.get("course-off@example.com")?.emailReason).toBe("course_email_opt_out");
    expect(byEmail.get("marketing-off@example.com")?.emailReason).toBeNull();
  });

  it("SC-4: SMS status is the transactional smsableReason", async () => {
    enrollmentRows = [
      enrollment("e1", user("ok@example.com")),
      enrollment("e2", user("marketing-only@example.com")),
      enrollment("e3", user("stop@example.com")),
      enrollment("e4", user("nophone@example.com")),
    ];
    contacts.set("ok@example.com", contactRow("ok@example.com"));
    contacts.set(
      "marketing-only@example.com",
      contactRow("marketing-only@example.com", {
        smsMarketingConsentAt: NOW,
        smsTransactionalConsentAt: null,
      })
    );
    contacts.set("stop@example.com", contactRow("stop@example.com", { smsOptOutAt: NOW }));
    contacts.set("nophone@example.com", contactRow("nophone@example.com", { phone: null }));

    const audience = await resolveCohortMessageAudience("cohort-1", {
      includeInstructors: false,
      ensureContacts: true,
      now: NOW,
    });
    const byEmail = new Map(audience!.recipients.map((r) => [r.email, r.smsReason]));
    expect(byEmail.get("ok@example.com")).toBeNull();
    expect(byEmail.get("marketing-only@example.com")).toBe("no_sms_transactional_consent");
    expect(byEmail.get("stop@example.com")).toBe("sms_opt_out");
    expect(byEmail.get("nophone@example.com")).toBe("invalid_phone");
  });
});
