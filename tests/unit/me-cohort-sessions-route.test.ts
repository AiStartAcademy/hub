// tests/unit/me-cohort-sessions-route.test.ts
// SC9: the dashboard calendar's session feed resolves a join link per session,
// falling back to the cohort-wide Zoom link when the session carries none.

import { beforeEach, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

let currentSession: Row | null = null;
let sessionRows: Row[] = [];
const findManyCalls: Row[] = [];

// Spread the real module: bun's mock.module registry is process-wide, so a
// partial stub must keep every other export intact for other test files.
const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: async () => currentSession,
}));

mock.module("@/lib/prisma", () => ({
  default: {
    enrollment: {
      findMany: async () => [{ cohortId: "c1" }],
    },
    cohortSession: {
      findMany: async (args: Row) => {
        findManyCalls.push(args);
        return sessionRows;
      },
    },
    // The route also appends shared-series occurrences; none exist in these cases.
    seriesOccurrence: {
      findMany: async () => [],
    },
  },
}));

const { GET } = await import("@/app/api/me/cohort-sessions/route");

beforeEach(() => {
  findManyCalls.length = 0;
  sessionRows = [
    {
      id: "s-own",
      cohortId: "c1",
      title: "Day 1",
      meetingLink: "https://zoom.us/j/session",
      cohort: { title: "Cohort One", zoomLink: "https://zoom.us/j/cohort" },
    },
    {
      id: "s-inherit",
      cohortId: "c1",
      title: "Day 2",
      meetingLink: null,
      cohort: { title: "Cohort One", zoomLink: "https://zoom.us/j/cohort" },
    },
    {
      id: "s-none",
      cohortId: "c1",
      title: "Day 3",
      meetingLink: null,
      cohort: { title: "Cohort One", zoomLink: null },
    },
  ];
});

it("401 without a session", async () => {
  currentSession = null;
  const res = await GET(new Request("https://hub.test/api/me/cohort-sessions"));
  expect(res.status).toBe(401);
});

it("meetingLink is the session's own link, else the cohort's, else null (student)", async () => {
  currentSession = { user: { id: "u1", role: "STUDENT" } };
  const res = await GET(new Request("https://hub.test/api/me/cohort-sessions"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as Row[];
  expect(body.map((s) => [s.id, s.meetingLink])).toEqual([
    ["s-own", "https://zoom.us/j/session"],
    ["s-inherit", "https://zoom.us/j/cohort"],
    ["s-none", null],
  ]);
  // The cohort title the calendar already relies on is still there.
  expect((body[0].cohort as Row).title).toBe("Cohort One");
  const include = findManyCalls[0].include as Row;
  expect((include.cohort as Row).select).toEqual({ title: true, zoomLink: true });
});

it("staff feed gets the same fallback", async () => {
  currentSession = { user: { id: "u2", role: "ADMIN" } };
  const res = await GET(new Request("https://hub.test/api/me/cohort-sessions"));
  const body = (await res.json()) as Row[];
  expect(body[1].meetingLink).toBe("https://zoom.us/j/cohort");
});
