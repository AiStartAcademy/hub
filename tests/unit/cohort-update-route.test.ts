// tests/unit/cohort-update-route.test.ts
// PUT /api/cohorts/[id] persists memberEventType next to leadMagnet:
// a known type or null is written, undefined leaves the column untouched,
// anything else is a 400.

import { beforeEach, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

let currentSession: Row | null = null;
const updateCalls: Row[] = [];

const actualAuth = await import("@/lib/auth");
mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: async () => currentSession,
}));

mock.module("@/lib/prisma", () => ({
  default: {
    cohort: {
      findUnique: async () => ({ slug: "q-a", title: "Q&A" }),
      update: async (args: Row) => {
        updateCalls.push(args);
        return { id: "c1", ...(args.data as Row) };
      },
    },
  },
}));

const { PUT } = await import("@/app/api/cohorts/[id]/route");

function put(body: Row): Promise<Response> {
  return PUT(
    new Request("https://hub.test/api/cohorts/c1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "c1" }) }
  );
}

beforeEach(() => {
  currentSession = { user: { id: "u2", email: "a@x.io", role: "ADMIN" } };
  updateCalls.length = 0;
});

it("writes a known memberEventType", async () => {
  const res = await put({ memberEventType: "WEEKLY_QA", leadMagnet: false });
  expect(res.status).toBe(200);
  expect((updateCalls[0].data as Row).memberEventType).toBe("WEEKLY_QA");
  expect((updateCalls[0].data as Row).leadMagnet).toBe(false);
});

it("null clears it; undefined leaves it untouched", async () => {
  await put({ memberEventType: null });
  expect((updateCalls[0].data as Row).memberEventType).toBeNull();

  await put({ title: "Renamed" });
  expect("memberEventType" in (updateCalls[1].data as Row)).toBe(false);
});

it("an unknown value is a 400 and nothing is written", async () => {
  const res = await put({ memberEventType: "PARTY" });
  expect(res.status).toBe(400);
  expect(updateCalls).toHaveLength(0);
});
