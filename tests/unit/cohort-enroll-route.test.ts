// tests/unit/cohort-enroll-route.test.ts
// POST /api/cohorts/[id]/enroll counts capacity the way every other surface
// does: GroupMember rows plus pending, unexpired Stripe holds (seats.ts), not
// _count.members alone.

import { afterAll, beforeEach, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

let currentSession: Row | null = null;
let groupRow: Row | null = null;
const groupFindCalls: Row[] = [];
const transactions: unknown[][] = [];

const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: async () => currentSession,
}));

mock.module("@/lib/prisma", () => ({
  default: {
    cohort: { findFirst: async () => ({ id: "c1" }) },
    group: {
      findFirst: async (args: Row) => {
        groupFindCalls.push(args);
        return groupRow;
      },
    },
    groupMember: {
      findUnique: async () => null,
      create: (args: Row) => ({ op: "groupMember.create", args }),
    },
    enrollment: {
      upsert: (args: Row) => ({ op: "enrollment.upsert", args }),
    },
    $transaction: async (ops: unknown[]) => {
      transactions.push(ops);
      return ops;
    },
  },
}));

// Reminders are best-effort and hit prisma with shapes this stub does not
// implement; keep the rest of cohortAnchor real (mock.module is process-wide).
// Snapshot the real exports BEFORE mocking: the namespace is a live binding and
// would point at the stub afterwards. afterAll puts the real module back so
// later files (e.g. drip-engine-cohort-message.test.ts) test the real helper.
const actualAnchor = { ...(await import("@/lib/drip/cohortAnchor")) };
mock.module("@/lib/drip/cohortAnchor", () => ({
  ...actualAnchor,
  enrollInCohortReminderCampaigns: async () => false,
}));
afterAll(() => {
  mock.module("@/lib/drip/cohortAnchor", () => actualAnchor);
});

const { POST } = await import("@/app/api/cohorts/[id]/enroll/route");

function post(groupId = "g1"): Promise<Response> {
  return POST(
    new Request("https://hub.test/api/cohorts/c1/enroll", {
      method: "POST",
      body: JSON.stringify({ groupId }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "c1" }) }
  );
}

beforeEach(() => {
  currentSession = { user: { id: "u1", email: "s@example.com", role: "STUDENT" } };
  groupFindCalls.length = 0;
  transactions.length = 0;
});

it("a pending Stripe hold counts as a taken seat: 2 members + 1 hold of 3 seats → 409", async () => {
  groupRow = {
    id: "g1",
    price: 0,
    seats: 3,
    _count: { members: 2 },
    payments: [{ id: "hold-1" }],
  };
  const res = await post();
  expect(res.status).toBe(409);
  expect(transactions).toHaveLength(0);
});

it("without the hold the same group still has a seat → 200", async () => {
  groupRow = {
    id: "g1",
    price: 0,
    seats: 3,
    _count: { members: 2 },
    payments: [],
  };
  const res = await post();
  expect(res.status).toBe(200);
  expect(transactions).toHaveLength(1);
});

it("looks the group up with the seat include (members count + pending holds)", async () => {
  groupRow = { id: "g1", price: 0, seats: 3, _count: { members: 0 }, payments: [] };
  await post();
  const args = groupFindCalls[0];
  expect(args.where).toEqual({ id: "g1", cohortId: "c1" });
  const select = args.select as Row;
  expect(select._count).toEqual({ select: { members: true } });
  expect((select.payments as Row).where).toMatchObject({ status: "pending" });
});
