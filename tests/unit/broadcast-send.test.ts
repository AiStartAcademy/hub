import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Prisma } from "@/generated/client";

type Row = Record<string, unknown>;

type BroadcastCounts = {
  leads: number;
  users: number;
  buyers: number;
  dedup: number;
  suppressed: number;
};

const NOW = new Date("2026-09-03T18:00:00.000Z");
const COUNTS: BroadcastCounts = {
  leads: 2,
  users: 0,
  buyers: 0,
  dedup: 0,
  suppressed: 0,
};

const calls = {
  audience: [] as Array<{ segment: unknown; options?: { now?: Date } }>,
  campaignFindMany: [] as Row[],
  campaignFindUnique: [] as Row[],
  campaignUpdate: [] as Row[],
  enrollmentCreate: [] as Row[],
  enrollmentUpsert: [] as Row[],
};

let audience = { contactIds: ["contact-1", "contact-2"], counts: COUNTS };
let campaign: Row;
let enrollmentKeys = new Set<string>();
let enrollmentFailure: unknown = null;
let mcpWritesAllowed = true;

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["campaignId", "contactId", "cohortId"] },
  });
}

function makeCampaign(overrides: Row = {}): Row {
  return {
    id: "broadcast-1",
    slug: "september-news",
    name: "September news",
    description: null,
    status: "DRAFT",
    trigger: "BROADCAST",
    segment: JSON.stringify({ sources: ["manual"] }),
    autoEnroll: false,
    exitOnStatuses: "[]",
    priority: 0,
    timezone: "America/Los_Angeles",
    sendWindowStartHour: 9,
    sendWindowEndHour: 17,
    skipWeekends: true,
    testEmail: null,
    sentAt: null,
    audienceSnapshot: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    steps: [
      {
        id: "step-1",
        campaignId: "broadcast-1",
        order: 1,
        delayHours: 0,
        anchor: null,
        offsetMinutes: null,
        channel: "EMAIL",
        subject: "September news",
        body: "Hello",
        ctaLabel: null,
        ctaUrl: null,
      },
    ],
    ...overrides,
  };
}

function enrollmentKey(row: Row): string {
  return `${String(row.campaignId)}:${String(row.contactId)}:${String(row.cohortId ?? "")}`;
}

const prismaMock = {
  dripCampaign: {
    findUnique: async (args: Row) => {
      calls.campaignFindUnique.push(args);
      return campaign;
    },
    findFirst: async (args: Row) => {
      calls.campaignFindUnique.push(args);
      return campaign;
    },
    findMany: async (args: Row) => {
      calls.campaignFindMany.push(args);
      const where = (args.where ?? {}) as Row;

      // Make the broadcast a canary: a sweep that omits its trigger constraint,
      // or explicitly asks for BROADCAST, will receive it.
      if (where.trigger === "BROADCAST" || !("trigger" in where)) return [campaign];
      return [];
    },
    // Same canary rule as findMany: enrollCohortAudiences short-circuits on a
    // count() before it queries, so the count has to lie the same way or the
    // sweep never reaches the findMany the assertions read.
    count: async (args: Row) => {
      calls.campaignFindMany.push(args);
      const where = (args.where ?? {}) as Row;
      if (where.trigger === "BROADCAST" || !("trigger" in where)) return 1;
      return 0;
    },
    update: async (args: Row) => {
      calls.campaignUpdate.push(args);
      campaign = { ...campaign, ...((args.data ?? {}) as Row) };
      return campaign;
    },
  },
  dripEnrollment: {
    create: async (args: Row) => {
      calls.enrollmentCreate.push(args);
      if (enrollmentFailure) throw enrollmentFailure;
      const data = (args.data ?? {}) as Row;
      const key = enrollmentKey(data);
      if (enrollmentKeys.has(key)) throw uniqueConstraintError();
      enrollmentKeys.add(key);
      return data;
    },
    upsert: async (args: Row) => {
      calls.enrollmentUpsert.push(args);
      const create = (args.create ?? {}) as Row;
      enrollmentKeys.add(enrollmentKey(create));
      return create;
    },
    findMany: async () => [],
  },
  contact: {
    findMany: async () => [],
  },
  // tick() runs syncAbandonedCheckouts before any enrollment sweep, and that
  // reads Payment + Membership. Empty results keep SC-16 about the sweep's
  // trigger filter rather than about abandoned-checkout behaviour.
  payment: {
    findMany: async () => [],
  },
  membership: {
    findMany: async () => [],
  },
  cohort: {
    findMany: async () => [],
  },
  enrollment: {
    findMany: async () => [],
  },
  $transaction: async (operation: unknown) => {
    if (typeof operation === "function") {
      return operation(prismaMock);
    }
    return Promise.all(operation as Promise<unknown>[]);
  },
};

mock.module("@/lib/prisma", () => ({ default: prismaMock }));

mock.module("@/lib/drip/audience", () => ({
  resolveBroadcastAudience: async (
    segment: unknown,
    options?: { now?: Date }
  ) => {
    calls.audience.push({ segment, options });
    return audience;
  },
}));

// Spread the real module — see the note in certificate-download-route.test.ts.
// Without this, helpers this file does not stub (parseJsonObject, ...) go
// missing for every other file in the same run.
const actualMcpApi = await import("@/lib/mcpApi");
mock.module("@/lib/mcpApi", () => ({
  ...actualMcpApi,
  mcpError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  mcpJson: (body: unknown, status = 200) => Response.json(body, { status }),
  mcpWritesEnabled: async () => mcpWritesAllowed,
  requireMcpToken: async () => null,
}));

const { sendBroadcast } = await import("@/lib/drip/broadcast");
const { tick } = await import("@/lib/drip/engine");

function resetFixtures(): void {
  calls.audience.length = 0;
  calls.campaignFindMany.length = 0;
  calls.campaignFindUnique.length = 0;
  calls.campaignUpdate.length = 0;
  calls.enrollmentCreate.length = 0;
  calls.enrollmentUpsert.length = 0;
  audience = { contactIds: ["contact-1", "contact-2"], counts: { ...COUNTS } };
  campaign = makeCampaign();
  enrollmentKeys = new Set();
  enrollmentFailure = null;
  mcpWritesAllowed = true;
}

describe("sendBroadcast", () => {
  beforeEach(resetFixtures);

  it("SC-9: dryRun resolves the audience and writes nothing", async () => {
    const result = await sendBroadcast("broadcast-1", { dryRun: true, now: NOW });

    expect(result).toEqual({
      ok: true,
      enrolled: 2,
      counts: COUNTS,
      dryRun: true,
    });
    expect(calls.audience).toHaveLength(1);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.enrollmentUpsert).toHaveLength(0);
    expect(calls.campaignUpdate).toHaveLength(0);
  });

  it("SC-10: send creates exactly one enrollment per resolved contact", async () => {
    const result = await sendBroadcast("broadcast-1", { now: NOW });

    expect(result).toMatchObject({ ok: true, enrolled: 2, dryRun: false });
    expect(calls.enrollmentCreate).toHaveLength(2);
    expect(calls.enrollmentCreate.map((call) => call.data)).toEqual([
      expect.objectContaining({
        campaignId: "broadcast-1",
        contactId: "contact-1",
        cohortId: "",
      }),
      expect.objectContaining({
        campaignId: "broadcast-1",
        contactId: "contact-2",
        cohortId: "",
      }),
    ]);
    expect(enrollmentKeys.size).toBe(2);
  });

  it("SC-11: re-running send creates no additional enrollments", async () => {
    const first = await sendBroadcast("broadcast-1", { now: NOW });
    const second = await sendBroadcast("broadcast-1", { now: NOW });

    expect(first).toMatchObject({ ok: true, enrolled: 2 });
    expect(second).toMatchObject({ ok: true, enrolled: 0 });
    expect(calls.enrollmentCreate).toHaveLength(4);
    expect(enrollmentKeys.size).toBe(2);
  });

  it("SC-3/SC-5: a duplicate (P2002) is skipped without failing the send", async () => {
    // contact-1 is already enrolled; only contact-2 is a fresh create.
    enrollmentKeys.add("broadcast-1:contact-1:");

    const result = await sendBroadcast("broadcast-1", { now: NOW });

    expect(result).toMatchObject({ ok: true, enrolled: 1, dryRun: false });
    expect(calls.enrollmentCreate).toHaveLength(2);
    expect(calls.campaignUpdate).toHaveLength(1);
  });

  it("SC-3: a non-P2002 enrollment error propagates instead of being swallowed", async () => {
    enrollmentFailure = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed",
      { code: "P2003", clientVersion: "test" }
    );

    await expect(sendBroadcast("broadcast-1", { now: NOW })).rejects.toThrow();
    expect(calls.campaignUpdate).toHaveLength(0);
  });

  it("SC-12: refuses a campaign with an empty audience", async () => {
    audience = { contactIds: [], counts: { ...COUNTS, leads: 0 } };

    const result = await sendBroadcast("broadcast-1", { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.campaignUpdate).toHaveLength(0);
  });

  it("SC-13: refuses a campaign with no steps", async () => {
    campaign = makeCampaign({ steps: [] });

    const result = await sendBroadcast("broadcast-1", { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.campaignUpdate).toHaveLength(0);
  });

  it("SC-14: refuses an ARCHIVED campaign", async () => {
    campaign = makeCampaign({ status: "ARCHIVED" });

    const result = await sendBroadcast("broadcast-1", { now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    expect(calls.audience).toHaveLength(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.campaignUpdate).toHaveLength(0);
  });

  it("SC-15: sending flips the campaign to ACTIVE and records sentAt + audienceSnapshot", async () => {
    const result = await sendBroadcast("broadcast-1", { now: NOW });

    expect(result.ok).toBe(true);
    expect(calls.campaignUpdate).toHaveLength(1);
    const updateData = calls.campaignUpdate[0].data as Row;
    expect(updateData.status).toBe("ACTIVE");
    expect(updateData.sentAt).toEqual(NOW);
    expect(typeof updateData.audienceSnapshot).toBe("string");

    const snapshot = JSON.parse(String(updateData.audienceSnapshot));
    expect(snapshot).toMatchObject({
      contactIds: ["contact-1", "contact-2"],
      counts: COUNTS,
    });
  });
});

describe("broadcast enrollment isolation", () => {
  beforeEach(resetFixtures);

  it("SC-16: tick() never auto-enrolls a BROADCAST campaign", async () => {
    campaign = makeCampaign({ status: "ACTIVE", autoEnroll: true });

    await tick({ now: NOW });

    const whereClauses = calls.campaignFindMany.map((call) => call.where as Row);
    expect(whereClauses).toContainEqual(
      expect.objectContaining({
        status: "ACTIVE",
        autoEnroll: true,
        trigger: "LEAD_SEGMENT",
      })
    );
    expect(whereClauses).toContainEqual(
      expect.objectContaining({
        status: "ACTIVE",
        trigger: "COHORT_SCHEDULE",
      })
    );
    expect(
      whereClauses.some(
        (where) => where.trigger === "BROADCAST" || !("trigger" in where)
      )
    ).toBe(false);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.enrollmentCreate).toHaveLength(0);
    expect(calls.enrollmentUpsert).toHaveLength(0);
  });
});

describe("broadcast MCP route", () => {
  beforeEach(resetFixtures);

  it("internal broadcast route returns {campaignId, sent, failed}", async () => {
    const { POST } = await import(
      "@/app/api/internal/mcp/v1/drip/broadcast/route"
    );
    const response = await POST(
      new Request("http://localhost/api/internal/mcp/v1/drip/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: "broadcast-1" }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaignId: "broadcast-1",
      sent: 2,
      failed: 0,
      counts: COUNTS,
    });
  });

  it("returns 403 when MCP writes are disabled", async () => {
    mcpWritesAllowed = false;
    const { POST } = await import(
      "@/app/api/internal/mcp/v1/drip/broadcast/route"
    );
    const response = await POST(
      new Request("http://localhost/api/internal/mcp/v1/drip/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: "broadcast-1" }),
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "MCP writes are disabled" });
  });

  it("returns 403 from certificate notification when MCP writes are disabled", async () => {
    mcpWritesAllowed = false;
    const { POST } = await import(
      "@/app/api/internal/mcp/v1/cohorts/[id]/certificates/notify/route"
    );
    const response = await POST(
      new Request(
        "http://localhost/api/internal/mcp/v1/cohorts/cohort-1/certificates/notify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }
      ),
      { params: Promise.resolve({ id: "cohort-1" }) }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "MCP writes are disabled" });
  });
});
