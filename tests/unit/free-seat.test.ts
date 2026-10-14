// tests/unit/free-seat.test.ts
// SC1/SC2 — granting a seat in a $0 group without Stripe: who needs the venue
// waiver, which session's join link the confirmation email carries, and the rows
// a registration has to leave behind for the cohort workspace to open.

import { describe, expect, it, mock } from "bun:test";

type UserRow = { id: string; email: string; name: string | null; password: string | null };

const db = {
  users: [] as UserRow[],
  groupMembers: [] as Array<{ groupId: string; userId: string }>,
  enrollments: [] as Array<Record<string, unknown>>,
  groups: [] as Array<{
    id: string;
    cohortId: string;
    seats: number;
    memberCount: number;
    pendingPayments: number;
  }>,
  transactions: 0,
};

const autoLinkCalls: string[] = [];
let autoLinkShouldThrow = false;

function resetDb() {
  db.users = [];
  db.groupMembers = [];
  db.enrollments = [];
  db.groups = [];
  db.transactions = 0;
  autoLinkCalls.length = 0;
  autoLinkShouldThrow = false;
}

let nextUserId = 0;

mock.module("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        db.users.find((u) => u.email === where.email) ?? null,
      upsert: async ({
        where,
        create,
      }: {
        where: { email: string };
        create: { email: string; name: string | null; role: string; attribution: string | null };
      }) => {
        const existing = db.users.find((u) => u.email === where.email);
        if (existing) return existing;
        const row: UserRow = {
          id: `user-${++nextUserId}`,
          email: create.email,
          name: create.name,
          password: null,
        };
        db.users.push(row);
        return row;
      },
    },
    group: {
      findFirst: async ({ where }: { where: { id: string; cohortId: string } }) => {
        const group = db.groups.find((g) => g.id === where.id && g.cohortId === where.cohortId);
        if (!group) return null;
        return {
          id: group.id,
          cohortId: group.cohortId,
          seats: group.seats,
          _count: { members: group.memberCount },
          payments: Array.from({ length: group.pendingPayments }, (_, i) => ({ id: `p${i}` })),
        };
      },
    },
    groupMember: {
      findUnique: async ({
        where,
      }: {
        where: { groupId_userId: { groupId: string; userId: string } };
      }) =>
        db.groupMembers.find(
          (m) =>
            m.groupId === where.groupId_userId.groupId &&
            m.userId === where.groupId_userId.userId
        ) ?? null,
      upsert: async ({
        where,
      }: {
        where: { groupId_userId: { groupId: string; userId: string } };
      }) => {
        const { groupId, userId } = where.groupId_userId;
        const existing = db.groupMembers.find((m) => m.groupId === groupId && m.userId === userId);
        if (existing) return existing;
        const row = { groupId, userId };
        db.groupMembers.push(row);
        return row;
      },
    },
    enrollment: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_cohortId: { userId: string; cohortId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const { userId, cohortId } = where.userId_cohortId;
        const existing = db.enrollments.find(
          (e) => e.userId === userId && e.cohortId === cohortId
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create };
        db.enrollments.push(row);
        return row;
      },
    },
    $transaction: async (ops: Array<Promise<unknown>>) => {
      db.transactions += 1;
      return Promise.all(ops);
    },
  },
}));

// Spread the real module: bun's mock.module registry is process-wide, so a
// partial stub deletes the untouched exports for every other file in the run.
const actualLinking = await import("@/lib/leads/linking");
mock.module("@/lib/leads/linking", () => ({
  ...actualLinking,
  autoLinkContactForUser: async (userId: string) => {
    autoLinkCalls.push(userId);
    if (autoLinkShouldThrow) throw new Error("contact link exploded");
    return null;
  },
}));

const {
  isFreeGroup,
  waiverRequired,
  nextUpcomingSession,
  nextSessionJoinLink,
  grantFreeSeat,
  GroupFullError,
} = await import("@/lib/freeSeat");

const SESSIONS = [
  {
    id: "s-past",
    date: new Date("2026-09-02T00:00:00.000Z"),
    startTime: "6:00 PM",
    endTime: "8:00 PM",
    timezone: "PT",
    meetingLink: null,
  },
  {
    id: "s-next",
    date: new Date("2026-09-09T00:00:00.000Z"),
    startTime: "6:00 PM",
    endTime: "8:00 PM",
    timezone: "PT",
    meetingLink: null,
  },
  {
    id: "s-later",
    date: new Date("2026-09-16T00:00:00.000Z"),
    startTime: "6:00 PM",
    endTime: "8:00 PM",
    timezone: "PT",
    meetingLink: null,
  },
];

const NOW = new Date("2026-09-09T12:00:00.000Z"); // morning of the Sep 9 session

describe("isFreeGroup", () => {
  it("SC1.1: a $0 group is free; any positive price is not", () => {
    expect(isFreeGroup({ price: 0 })).toBe(true);
    expect(isFreeGroup({ price: -1 })).toBe(true);
    expect(isFreeGroup({ price: 0.5 })).toBe(false);
    expect(isFreeGroup({ price: 150 })).toBe(false);
  });
});

describe("waiverRequired", () => {
  it("SC1.2: the Online Group of a HYBRID cohort never needs the venue waiver", () => {
    expect(
      waiverRequired({ group: { inPerson: false }, cohort: { deliveryMode: "HYBRID" } })
    ).toBe(false);
  });

  it("SC1.3: the In Person group needs it even when the cohort is ONLINE-labelled", () => {
    expect(
      waiverRequired({ group: { inPerson: true }, cohort: { deliveryMode: "ONLINE" } })
    ).toBe(true);
  });

  it("SC1.4: with no group chosen it falls back to the cohort delivery mode", () => {
    expect(waiverRequired({ group: null, cohort: { deliveryMode: "HYBRID" } })).toBe(true);
    expect(waiverRequired({ group: null, cohort: { deliveryMode: "INPERSON" } })).toBe(true);
    expect(waiverRequired({ group: null, cohort: { deliveryMode: "ONLINE" } })).toBe(false);
  });
});

describe("nextUpcomingSession", () => {
  it("SC1.5: picks the next session by end instant, never a past one", () => {
    expect(nextUpcomingSession(SESSIONS, NOW)?.id).toBe("s-next");
  });

  it("SC1.6: still picks the running session while it is on air", () => {
    // 18:30 PT on Sep 9 — started, not finished.
    const midSession = new Date("2026-09-10T01:30:00.000Z");
    expect(nextUpcomingSession(SESSIONS, midSession)?.id).toBe("s-next");
  });

  it("SC1.7: order of the input does not decide the answer", () => {
    expect(nextUpcomingSession([...SESSIONS].reverse(), NOW)?.id).toBe("s-next");
  });

  it("SC1.8: null when every session is over, and for an empty list", () => {
    expect(nextUpcomingSession(SESSIONS, new Date("2026-10-01T00:00:00.000Z"))).toBeNull();
    expect(nextUpcomingSession([], NOW)).toBeNull();
  });

  it("SC1.9: sessions whose stored time cannot be parsed are skipped, not thrown on", () => {
    const broken = [{ ...SESSIONS[1], id: "s-broken", startTime: "whenever", endTime: "later" }];
    expect(nextUpcomingSession(broken, NOW)).toBeNull();
    expect(nextUpcomingSession([...broken, SESSIONS[2]], NOW)?.id).toBe("s-later");
  });
});

describe("nextSessionJoinLink", () => {
  it("SC1.10: the session's own link wins and the when-line is in the cohort zone", () => {
    const result = nextSessionJoinLink(
      {
        zoomLink: "https://zoom.us/j/cohort",
        sessions: SESSIONS.map((s) =>
          s.id === "s-next" ? { ...s, meetingLink: "https://zoom.us/j/borrowed" } : s
        ),
      },
      NOW
    );
    expect(result?.session.id).toBe("s-next");
    expect(result?.link).toBe("https://zoom.us/j/borrowed");
    expect(result?.whenLine).toBe("09 SEP 2026 · 18:00 PDT");
  });

  it("SC1.11: falls back to the cohort link, then to no link at all", () => {
    expect(
      nextSessionJoinLink({ zoomLink: "https://zoom.us/j/cohort", sessions: SESSIONS }, NOW)?.link
    ).toBe("https://zoom.us/j/cohort");
    expect(nextSessionJoinLink({ zoomLink: null, sessions: SESSIONS }, NOW)?.link).toBeNull();
  });

  it("SC1.12: null when nothing is upcoming — never a link to a session that already ran", () => {
    expect(
      nextSessionJoinLink(
        { zoomLink: "https://zoom.us/j/cohort", sessions: SESSIONS },
        new Date("2026-10-01T00:00:00.000Z")
      )
    ).toBeNull();
  });
});

describe("grantFreeSeat", () => {
  const input = {
    cohortId: "cohort-1",
    groupId: "group-online",
    email: "student@example.com",
    name: "Ada Lovelace",
    attribution: '{"utm_source":"meta"}',
    segment: "founder",
  };

  function seedGroup(overrides: Partial<(typeof db.groups)[number]> = {}) {
    db.groups.push({
      id: "group-online",
      cohortId: "cohort-1",
      seats: 50,
      memberCount: 0,
      pendingPayments: 0,
      ...overrides,
    });
  }

  it("SC2.1: creates a passwordless STUDENT, the GroupMember and a free Enrollment", async () => {
    resetDb();
    seedGroup();
    const result = await grantFreeSeat(input);

    expect(result.isNewAccount).toBe(true);
    expect(db.users).toHaveLength(1);
    expect(db.users[0].email).toBe("student@example.com");
    expect(db.users[0].password).toBeNull();
    expect(db.groupMembers).toEqual([{ groupId: "group-online", userId: result.userId }]);
    expect(db.enrollments).toEqual([
      {
        userId: result.userId,
        cohortId: "cohort-1",
        source: "free",
        attribution: '{"utm_source":"meta"}',
        segment: "founder",
      },
    ]);
    // Both rows in one transaction — a seat without an enrollment hides the cohort.
    expect(db.transactions).toBe(1);
  });

  it("SC2.2: links the freshly created user to their existing Contact", async () => {
    resetDb();
    seedGroup();
    const result = await grantFreeSeat(input);
    expect(autoLinkCalls).toEqual([result.userId]);
  });

  it("SC2.3: a failing contact link never costs the registrant their seat", async () => {
    resetDb();
    seedGroup();
    autoLinkShouldThrow = true;
    const result = await grantFreeSeat(input);
    expect(result.isNewAccount).toBe(true);
    expect(db.groupMembers).toHaveLength(1);
    expect(db.enrollments).toHaveLength(1);
  });

  it("SC2.4: an existing account is reused, not re-linked, and keeps isNewAccount false", async () => {
    resetDb();
    seedGroup();
    db.users.push({
      id: "user-existing",
      email: "student@example.com",
      name: "Ada",
      password: "hashed",
    });
    const result = await grantFreeSeat(input);
    expect(result).toEqual({ userId: "user-existing", isNewAccount: false });
    expect(autoLinkCalls).toEqual([]);
    expect(db.users).toHaveLength(1);
  });

  it("SC2.5: re-registering is idempotent — no duplicate seat or enrollment", async () => {
    resetDb();
    seedGroup();
    const first = await grantFreeSeat(input);
    const second = await grantFreeSeat(input);
    expect(second.userId).toBe(first.userId);
    expect(db.users).toHaveLength(1);
    expect(db.groupMembers).toHaveLength(1);
    expect(db.enrollments).toHaveLength(1);
  });

  it("SC2.6: re-registering re-activates an enrollment that had been dropped", async () => {
    resetDb();
    seedGroup();
    const first = await grantFreeSeat(input);
    db.enrollments[0].status = "dropped";
    await grantFreeSeat(input);
    expect(db.enrollments[0].status).toBe("active");
    expect(db.enrollments[0].userId).toBe(first.userId);
  });

  it("SC2.7: a full group throws GroupFullError — pending Stripe holds count as taken", async () => {
    resetDb();
    seedGroup({ seats: 2, memberCount: 1, pendingPayments: 1 });
    const error = await grantFreeSeat(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GroupFullError);
    expect((error as InstanceType<typeof GroupFullError>).reason).toBe("full");
    expect(db.groupMembers).toHaveLength(0);
    expect(db.enrollments).toHaveLength(0);
  });

  it("SC2.8: an existing member of a full group still gets through", async () => {
    resetDb();
    seedGroup({ seats: 1, memberCount: 1 });
    db.users.push({
      id: "user-existing",
      email: "student@example.com",
      name: "Ada",
      password: null,
    });
    db.groupMembers.push({ groupId: "group-online", userId: "user-existing" });
    const result = await grantFreeSeat(input);
    expect(result.userId).toBe("user-existing");
    expect(db.enrollments).toHaveLength(1);
  });

  it("SC2.9: an unknown group id is rejected before any seat is granted", async () => {
    resetDb();
    const error = await grantFreeSeat({ ...input, groupId: "nope" }).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(GroupFullError);
    expect((error as InstanceType<typeof GroupFullError>).reason).toBe("missing");
    expect(db.groupMembers).toHaveLength(0);
  });

  it("SC2.10: with no group (a lead-magnet cohort) it enrolls without a GroupMember", async () => {
    resetDb();
    const result = await grantFreeSeat({ ...input, groupId: null });
    expect(db.groupMembers).toHaveLength(0);
    expect(db.enrollments).toHaveLength(1);
    expect(db.enrollments[0].userId).toBe(result.userId);
  });
});
