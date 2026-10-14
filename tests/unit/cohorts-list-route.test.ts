// tests/unit/cohorts-list-route.test.ts
// SC10: GET /api/cohorts hands live Zoom links only to managers; everyone
// else gets the row with zoomLink / zoomMeetingId nulled.
// POST /api/cohorts persists memberEventType next to leadMagnet.

import { beforeEach, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

let currentSession: Row | null = null;
let cohortRows: Row[] = [];
const cohortFindManyCalls: Row[] = [];
const cohortCreateCalls: Row[] = [];

const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: async () => currentSession,
}));

mock.module("@/lib/prisma", () => ({
  default: {
    cohort: {
      findMany: async (args: Row) => {
        cohortFindManyCalls.push(args);
        return cohortRows;
      },
    },
    enrollment: { findMany: async () => [] },
    groupMember: { findMany: async () => [] },
    $transaction: async (fn: (tx: Row) => Promise<unknown>) =>
      fn({
        program: { create: async () => ({ id: "raw-1" }) },
        cohort: {
          create: async (args: Row) => {
            cohortCreateCalls.push(args);
            return { id: "c-new", title: "New", rawProgramId: "raw-1", ...(args.data as Row) };
          },
        },
      }),
  },
}));

const actualSlug = await import("@/lib/slug");
mock.module("@/lib/slug", () => ({
  ...actualSlug,
  uniqueCohortSlug: async (title: string) => title.toLowerCase().replace(/\s+/g, "-"),
}));

const { GET, POST } = await import("@/app/api/cohorts/route");

function post(body: Row): Promise<Response> {
  return POST(
    new Request("https://hub.test/api/cohorts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

beforeEach(() => {
  cohortFindManyCalls.length = 0;
  cohortCreateCalls.length = 0;
  cohortRows = [
    {
      id: "c1",
      title: "Q&A",
      status: "ENROLLMENT",
      zoomLink: "https://zoom.us/j/secret",
      zoomMeetingId: "123456",
      groups: [{ seats: 10, _count: { members: 2 } }],
      _count: { groups: 1, sessions: 4 },
      instructors: [],
      programs: [],
    },
  ];
});

it("guest gets the row with zoomLink and zoomMeetingId nulled", async () => {
  currentSession = null;
  const res = await GET();
  expect(res.status).toBe(200);
  const body = (await res.json()) as Row[];
  expect(body).toHaveLength(1);
  expect(body[0].id).toBe("c1");
  expect(body[0].zoomLink).toBeNull();
  expect(body[0].zoomMeetingId).toBeNull();
  expect(body[0].totalMembers).toBe(2);
  expect(body[0].seats).toBe(10);
});

it("student gets the row redacted too", async () => {
  currentSession = { user: { id: "u1", role: "STUDENT" } };
  const res = await GET();
  const body = (await res.json()) as Row[];
  expect(body[0].zoomLink).toBeNull();
  expect(body[0].zoomMeetingId).toBeNull();
});

it("admin keeps the live values", async () => {
  currentSession = { user: { id: "u2", role: "ADMIN" } };
  const res = await GET();
  const body = (await res.json()) as Row[];
  expect(body[0].zoomLink).toBe("https://zoom.us/j/secret");
  expect(body[0].zoomMeetingId).toBe("123456");
});

it("POST persists memberEventType (WEEKLY_QA), defaulting to null when omitted", async () => {
  currentSession = { user: { id: "u2", email: "a@x.io", role: "ADMIN" } };
  const res = await post({ title: "Q&A", memberEventType: "WEEKLY_QA" });
  expect(res.status).toBe(201);
  expect((cohortCreateCalls[0].data as Row).memberEventType).toBe("WEEKLY_QA");
  expect((cohortCreateCalls[0].data as Row).leadMagnet).toBe(false);

  const plain = await post({ title: "Plain" });
  expect(plain.status).toBe(201);
  expect((cohortCreateCalls[1].data as Row).memberEventType).toBeNull();
});

it("POST rejects an unknown memberEventType with 400", async () => {
  currentSession = { user: { id: "u2", email: "a@x.io", role: "ADMIN" } };
  const res = await post({ title: "Q&A", memberEventType: "PARTY" });
  expect(res.status).toBe(400);
  expect(cohortCreateCalls).toHaveLength(0);
});
