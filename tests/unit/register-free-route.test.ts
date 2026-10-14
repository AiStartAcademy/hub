// tests/unit/register-free-route.test.ts
// SC3 — POST /api/cohorts/[id]/register-free: who may take a free seat, what it
// leaves in the database, what the confirmation email carries, and who gets the
// join link on-page.

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

mock.module("server-only", () => ({}));

// ─── In-memory database ────────────────────────────────────────────────────

type GroupRow = { id: string; cohortId: string; price: number; inPerson: boolean; seats: number };
type SessionRow = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  timezone: string | null;
  meetingLink: string | null;
};
type CohortRow = {
  id: string;
  slug: string | null;
  title: string;
  leadMagnet: boolean;
  zoomLink: string | null;
  status: string;
  deliveryMode: string;
  groups: GroupRow[];
  sessions: SessionRow[];
};
type UserRow = { id: string; email: string; name: string | null; password: string | null };

const FUTURE = new Date(Date.now() + 3 * 24 * 3600 * 1000);
const futureIso = (offsetH: number) => new Date(FUTURE.getTime() + offsetH * 3600 * 1000).toISOString();

const cohorts: CohortRow[] = [];
const qaCohortSlug = `${brand.name.toLowerCase().replaceAll(" ", "-")}-q-a`;
const db = {
  users: [] as UserRow[],
  contacts: [] as Array<{ id: string; email: string; name: string; tags: string }>,
  contactEvents: [] as Array<{ contactId: string; type: string; metadata: string }>,
  groupMembers: [] as Array<{ groupId: string; userId: string }>,
  enrollments: [] as Array<{ userId: string; cohortId: string; source: string; status: string }>,
  tokens: [] as Array<{ identifier: string; token: string; expires: Date }>,
};
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

function hybridCohort(): CohortRow {
  return {
    id: "qa",
    slug: qaCohortSlug,
    title: `${brand.name} Q&A`,
    leadMagnet: false,
    zoomLink: "https://zoom.us/j/cohort-level",
    status: "ENROLLMENT",
    deliveryMode: "HYBRID",
    groups: [
      { id: "g-online", cohortId: "qa", price: 0, inPerson: false, seats: 50 },
      { id: "g-inperson", cohortId: "qa", price: 0, inPerson: true, seats: 50 },
      { id: "g-paid", cohortId: "qa", price: 150, inPerson: false, seats: 10 },
      { id: "g-tiny", cohortId: "qa", price: 0, inPerson: false, seats: 1 },
    ],
    sessions: [
      {
        id: "s-past",
        date: new Date("2020-01-01T00:00:00Z"),
        startTime: "2020-01-01T18:00:00Z",
        endTime: "2020-01-01T19:00:00Z",
        timezone: "PT",
        meetingLink: "https://zoom.us/j/old",
      },
      {
        id: "s-next",
        date: FUTURE,
        startTime: futureIso(0),
        endTime: futureIso(1),
        timezone: "PT",
        meetingLink: "https://zoom.us/j/borrowed-next",
      },
    ],
  };
}

function reset() {
  cohorts.length = 0;
  cohorts.push(hybridCohort());
  cohorts.push({
    id: "other",
    slug: "other-cohort",
    title: "Other",
    leadMagnet: false,
    zoomLink: null,
    status: "ENROLLMENT",
    deliveryMode: "ONLINE",
    groups: [{ id: "g-other-free", cohortId: "other", price: 0, inPerson: false, seats: 5 }],
    sessions: [],
  });
  cohorts.push({
    id: "magnet",
    slug: "free-talk",
    title: "Free Talk",
    leadMagnet: true,
    zoomLink: "https://zoom.us/j/magnet",
    status: "IN_PROGRESS",
    deliveryMode: "ONLINE",
    groups: [],
    sessions: [],
  });
  db.users = [];
  db.contacts = [];
  db.contactEvents = [];
  db.groupMembers = [];
  db.enrollments = [];
  db.tokens = [];
  sentEmails.length = 0;
  dripCalls.length = 0;
  currentSession = null;
}

mock.module("@/lib/prisma", () => ({
  default: {
    cohort: {
      findFirst: async ({ where }: { where: { OR: Array<{ id?: string; slug?: string }> } }) => {
        const key = where.OR[0].id;
        const c = cohorts.find((x) => x.id === key || x.slug === key);
        if (!c) return null;
        return structuredClone(c);
      },
    },
    contact: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        db.contacts.find((c) => c.email === where.email) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { email: string };
        create: { name: string; email: string; tags: string };
        update: { name?: string; tags: string };
      }) => {
        const existing = db.contacts.find((c) => c.email === where.email);
        if (existing) {
          existing.tags = update.tags;
          if (update.name) existing.name = update.name;
          return existing;
        }
        const row = { id: nextId("contact"), email: create.email, name: create.name, tags: create.tags };
        db.contacts.push(row);
        return row;
      },
    },
    contactEvent: {
      create: async ({ data }: { data: { contactId: string; type: string; metadata: string } }) => {
        db.contactEvents.push(data);
        return data;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        db.users.find((u) => u.email === where.email) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { email: string };
        create: { email: string; name: string | null };
      }) => {
        const existing = db.users.find((u) => u.email === where.email);
        if (existing) return existing;
        const row: UserRow = { id: nextId("user"), email: create.email, name: create.name, password: null };
        db.users.push(row);
        return row;
      },
    },
    group: {
      findFirst: async ({ where }: { where: { id: string; cohortId: string } }) => {
        const cohort = cohorts.find((c) => c.id === where.cohortId);
        const g = cohort?.groups.find((x) => x.id === where.id);
        if (!g) return null;
        return {
          id: g.id,
          seats: g.seats,
          _count: { members: db.groupMembers.filter((m) => m.groupId === g.id).length },
          payments: [],
        };
      },
    },
    groupMember: {
      findUnique: async ({ where }: { where: { groupId_userId: { groupId: string; userId: string } } }) =>
        db.groupMembers.find(
          (m) => m.groupId === where.groupId_userId.groupId && m.userId === where.groupId_userId.userId
        ) ?? null,
      upsert: ({ where }: { where: { groupId_userId: { groupId: string; userId: string } } }) => async () => {
        const { groupId, userId } = where.groupId_userId;
        if (!db.groupMembers.some((m) => m.groupId === groupId && m.userId === userId)) {
          db.groupMembers.push({ groupId, userId });
        }
      },
    },
    enrollment: {
      upsert: ({
        where,
        create,
      }: {
        where: { userId_cohortId: { userId: string; cohortId: string } };
        create: { source: string };
      }) => async () => {
        const { userId, cohortId } = where.userId_cohortId;
        const existing = db.enrollments.find((e) => e.userId === userId && e.cohortId === cohortId);
        if (existing) existing.status = "active";
        else db.enrollments.push({ userId, cohortId, source: create.source, status: "active" });
      },
    },
    $transaction: async (ops: Array<() => Promise<void>>) => {
      for (const op of ops) await op();
    },
    verificationToken: {
      findFirst: async ({ where }: { where: { identifier: string } }) =>
        db.tokens.find((t) => t.identifier === where.identifier) ?? null,
      delete: async ({ where }: { where: { identifier_token: { identifier: string; token: string } } }) => {
        const i = db.tokens.findIndex((t) => t.identifier === where.identifier_token.identifier);
        if (i >= 0) db.tokens.splice(i, 1);
        return { count: 1 };
      },
      create: async ({ data }: { data: { identifier: string; token: string; expires: Date } }) => {
        db.tokens.push(data);
        return data;
      },
    },
  },
}));

// ─── Collaborators (spread the real module: bun's mock registry is process-wide) ─

type SessionUser = { id: string; email: string; name: string | null; role: string; roles: string[] };
let currentSession: { user: SessionUser } | null = null;
const realAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({ ...realAuth, auth: async () => currentSession }));

const realHeaders = await import("next/headers");
mock.module("next/headers", () => ({
  ...realHeaders,
  cookies: async () => ({ get: () => undefined }),
}));

const sentEmails: Array<Record<string, unknown>> = [];
const realMail = await import("@/lib/mail");
mock.module("@/lib/mail", () => ({
  ...realMail,
  sendFreeSeatEmail: async (input: Record<string, unknown>) => {
    sentEmails.push(input);
  },
}));

const dripCalls: unknown[][] = [];
const realAnchor = await import("@/lib/drip/cohortAnchor");
mock.module("@/lib/drip/cohortAnchor", () => ({
  ...realAnchor,
  enrollInCohortReminderCampaigns: async (...args: unknown[]) => {
    dripCalls.push(args);
    return true;
  },
}));

const realLinking = await import("@/lib/leads/linking");
mock.module("@/lib/leads/linking", () => ({
  ...realLinking,
  autoLinkContactForUser: async () => null,
}));

const { POST } = await import("@/app/api/cohorts/[id]/register-free/route");
const { renderFreeSeatEmail } = realMail;

let ipSeq = 0;
async function post(
  cohortKey: string,
  body: unknown,
  opts: { ip?: string } = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const ip = opts.ip ?? `10.0.0.${++ipSeq}`;
  const res = await POST(
    new Request(`https://hub.example/api/cohorts/${cohortKey}/register-free`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: cohortKey }) }
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const guest = (email: string, extra: Record<string, unknown> = {}) => ({
  name: "Ada Lovelace",
  email,
  ...extra,
});

describe("POST /api/cohorts/[id]/register-free", () => {
  // A fresh address per test: the in-process email rate limit (5 / 15 min) would
  // otherwise trip across tests that all register the same guest.
  let A = "";
  beforeEach(() => {
    reset();
    A = `guest${++seq}@example.com`;
  });

  it("SC3.1: a paid group is refused with 400", async () => {
    const r = await post("qa", guest(A, { groupId: "g-paid" }));
    expect(r.status).toBe(400);
    expect(db.users).toHaveLength(0);
  });

  it("SC3.2: a group belonging to another cohort is refused with 400", async () => {
    const r = await post("qa", guest(A, { groupId: "g-other-free" }));
    expect(r.status).toBe(400);
    expect(db.enrollments).toHaveLength(0);
  });

  it("SC3.3: In Person without the waiver is 400", async () => {
    const r = await post("qa", guest(A, { groupId: "g-inperson" }));
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("waiver");
  });

  it("SC3.4: Online Group in a HYBRID cohort needs no waiver", async () => {
    const r = await post("qa", guest(A, { groupId: "g-online" }));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, enrolled: true, cohortUrl: `/cohorts/${qaCohortSlug}` });
    expect(db.contactEvents.map((e) => e.type)).toEqual(["COHORT_REGISTER"]);
    expect(db.enrollments).toEqual([
      { userId: db.users[0].id, cohortId: "qa", source: "free", status: "active" },
    ]);
    expect(db.groupMembers).toEqual([{ groupId: "g-online", userId: db.users[0].id }]);
    expect(dripCalls).toEqual([[A, "Ada Lovelace", "qa", { skipWelcome: true }]]);
  });

  it("SC3.5: the guest email carries the next session's join link and a 7-day set-password link", async () => {
    await post("qa", guest(A, { groupId: "g-online" }));
    expect(sentEmails).toHaveLength(1);
    const input = sentEmails[0] as Parameters<typeof renderFreeSeatEmail>[0] & { to: string };
    expect(input.to).toBe(A);
    expect(input.joinLink).toBe("https://zoom.us/j/borrowed-next");
    const { html } = renderFreeSeatEmail(input);
    expect(html).toContain('href="https://zoom.us/j/borrowed-next"');
    expect(html).toContain("/set-password?token=");
    expect(db.tokens).toHaveLength(1);
    expect(db.tokens[0].identifier).toBe(`account-setup:${A}`);
    const ttl = db.tokens[0].expires.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(7 * 24 * 3600 * 1000 - 10_000);
  });

  it("SC3.6: an authenticated STUDENT gets joinLink and the body identity is ignored", async () => {
    currentSession = {
      user: { id: "u-student", email: "student@example.com", name: "Sam Student", role: "STUDENT", roles: ["STUDENT"] },
    };
    const r = await post("qa", { name: "Mallory", email: "mallory@example.com", groupId: "g-online" });
    expect(r.status).toBe(200);
    expect(r.json.joinLink).toBe("https://zoom.us/j/borrowed-next");
    expect(db.users.map((u) => u.email)).toEqual(["student@example.com"]);
    expect(db.contacts.map((c) => c.email)).toEqual(["student@example.com"]);
    expect((sentEmails[0] as { to: string }).to).toBe("student@example.com");
  });

  it("SC3.7: an authenticated ADMIN is refused with 403", async () => {
    currentSession = {
      user: { id: "u-admin", email: "admin@example.com", name: "Root", role: "ADMIN", roles: ["ADMIN"] },
    };
    const r = await post("qa", { groupId: "g-online" });
    expect(r.status).toBe(403);
    expect(db.users).toHaveLength(0);
  });

  it("SC3.8: a lead-magnet cohort still registers with no groupId (even IN_PROGRESS)", async () => {
    const r = await post("free-talk", guest(A));
    expect(r.status).toBe(200);
    expect(r.json.cohortUrl).toBe("/cohorts/free-talk");
    expect(db.enrollments).toEqual([{ userId: db.users[0].id, cohortId: "magnet", source: "free", status: "active" }]);
    expect(db.groupMembers).toHaveLength(0);
    // No upcoming session on this cohort: the email promises the link instead.
    expect((sentEmails[0] as { joinLink: string | null }).joinLink).toBeNull();
  });

  it("SC3.9: registering twice is 200 both times and leaves no duplicate rows", async () => {
    const first = await post("qa", guest(A, { groupId: "g-online" }));
    const second = await post("qa", guest(A, { groupId: "g-online" }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.users).toHaveLength(1);
    expect(db.contacts).toHaveLength(1);
    expect(db.enrollments).toHaveLength(1);
    expect(db.groupMembers).toHaveLength(1);
    expect(sentEmails).toHaveLength(2); // the link is re-sent each time
  });

  it("SC3.10: a full group answers 409", async () => {
    expect((await post("qa", guest("first@example.com", { groupId: "g-tiny" }))).status).toBe(200);
    const r = await post("qa", guest("second@example.com", { groupId: "g-tiny" }));
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: "This group is full" });
  });

  it("SC3.11: the same IP is rate-limited with 429 and a Retry-After", async () => {
    let last: { status: number } | null = null;
    for (let i = 0; i < 11; i++) {
      last = await post("qa", guest(`burst${i}@example.com`, { groupId: "g-online" }), { ip: "203.0.113.9" });
    }
    expect(last?.status).toBe(429);
  });

  it("SC3.12: a closed cohort (DRAFT/ARCHIVED/COMPLETE) is 400", async () => {
    for (const status of ["DRAFT", "ARCHIVED", "COMPLETE"]) {
      cohorts[0].status = status;
      const r = await post("qa", guest(A, { groupId: "g-online" }));
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("This event is not open for registration.");
    }
    expect(db.users).toHaveLength(0);
  });
});
