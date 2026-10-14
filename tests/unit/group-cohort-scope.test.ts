// tests/unit/group-cohort-scope.test.ts
// A group belongs to exactly one cohort. Both group-membership routes take the cohort id
// from the URL and enroll into it, so they must refuse a group that belongs to a different
// cohort — otherwise an instructor of cohort A can enroll anyone into cohort B for free.

import { beforeEach, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

let currentSession: Row | null = null;
const writes: string[] = [];

const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: async () => currentSession,
}));

const record = (name: string) => async () => {
  writes.push(name);
  return { id: "x", password: null, user: { id: "x", email: "new@example.com" } };
};

const db: Record<string, unknown> = {
    user: {
      findUnique: async () => ({ id: "u-new", email: "new@example.com" }),
      upsert: record("user.upsert"),
    },
    group: {
      // The group lives in cohort A; every request below claims cohort B in the URL.
      findUnique: async () => ({
        id: "g1",
        name: "General",
        cohortId: "cohort-A",
        cohort: { id: "cohort-A", title: "Cohort A", instructors: [{ id: "instructor-A" }] },
      }),
    },
    groupMember: {
      findUnique: async () => null,
      create: record("groupMember.create"),
    },
    enrollment: { upsert: record("enrollment.upsert") },
    verificationToken: { create: record("verificationToken.create") },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
};
mock.module("@/lib/prisma", () => ({ default: db }));

const members = await import("@/app/api/cohorts/[id]/groups/[groupId]/members/route");
const invites = await import("@/app/api/cohorts/[id]/groups/[groupId]/invites/route");

const params = Promise.resolve({ id: "cohort-B", groupId: "g1" });

beforeEach(() => {
  writes.length = 0;
  currentSession = { user: { id: "instructor-A", role: "INSTRUCTOR", roles: ["INSTRUCTOR"] } };
});

it("members POST rejects a group that belongs to another cohort, writing nothing", async () => {
  const req = new Request("https://hub.test/api/cohorts/cohort-B/groups/g1/members", {
    method: "POST",
    body: JSON.stringify({ userId: "u-new" }),
  });
  const res = await members.POST(req as never, { params } as never);
  expect(res.status).toBe(404);
  expect(writes).toEqual([]);
});

it("invites POST rejects a group that belongs to another cohort, writing nothing", async () => {
  const req = new Request("https://hub.test/api/cohorts/cohort-B/groups/g1/invites", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ email: "new@example.com" }),
  });
  const res = await invites.POST(req as never, { params } as never);
  expect(res.status).toBe(404);
  expect(writes).toEqual([]);
});
