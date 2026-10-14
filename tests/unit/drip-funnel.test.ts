import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  buildCampaignFunnel,
  type FunnelEnrollmentGroup,
  type FunnelSendInput,
  type FunnelStepInput,
} from "@/lib/drip/funnel";

// ── Fixture factories ────────────────────────────────────────────────
// Same house style as tests/unit/drip-admin.test.ts: a factory per input shape
// with Partial<> overrides, so each test states only what it's actually about.

let sendSeq = 0;
function step(order: number, overrides: Partial<FunnelStepInput> = {}): FunnelStepInput {
  return { id: `step-${order}`, order, channel: "EMAIL", ...overrides };
}

function send(stepId: string, overrides: Partial<FunnelSendInput> = {}): FunnelSendInput {
  sendSeq += 1;
  return {
    id: `send-${sendSeq}`,
    stepId,
    status: "SENT",
    openedAt: null,
    firstClickedAt: null,
    ...overrides,
  };
}

/** N sends against one step, all sharing the given overrides. */
function sends(stepId: string, count: number, overrides: Partial<FunnelSendInput> = {}) {
  return Array.from({ length: count }, () => send(stepId, overrides));
}

function group(
  status: string,
  lastStepOrder: number,
  count: number
): FunnelEnrollmentGroup {
  return { status, lastStepOrder, count };
}

function build(input: {
  steps?: FunnelStepInput[];
  sends?: FunnelSendInput[];
  enrollmentGroups?: FunnelEnrollmentGroup[];
  unsubscribedSendIds?: string[];
  dueNow?: number;
}) {
  return buildCampaignFunnel({
    steps: input.steps ?? [],
    sends: input.sends ?? [],
    enrollmentGroups: input.enrollmentGroups ?? [],
    unsubscribedSendIds: input.unsubscribedSendIds ?? [],
    dueNow: input.dueNow ?? 0,
  });
}

beforeEach(() => {
  sendSeq = 0;
});

describe("buildCampaignFunnel — retention", () => {
  it("computes step and cumulative retention down a clean sequence", () => {
    const steps = [step(1), step(2), step(3)];
    const funnel = build({
      steps,
      sends: [...sends("step-1", 10), ...sends("step-2", 8), ...sends("step-3", 6)],
    });

    expect(funnel.steps.map((s) => s.reached)).toEqual([10, 8, 6]);
    expect(funnel.steps.map((s) => s.stepRetentionPct)).toEqual([null, 80, 75]);
    expect(funnel.steps.map((s) => s.cumulativeRetentionPct)).toEqual([100, 80, 60]);
  });

  it("returns null ratios instead of NaN when a denominator is zero", () => {
    const funnel = build({ steps: [step(1), step(2)] });

    expect(funnel.steps[0].reached).toBe(0);
    expect(funnel.steps[0].stepRetentionPct).toBeNull();
    expect(funnel.steps[0].cumulativeRetentionPct).toBeNull();
    expect(funnel.steps[1].stepRetentionPct).toBeNull();
    for (const s of funnel.steps) {
      expect(Number.isNaN(s.stepRetentionPct as number)).toBe(false);
      expect(Number.isNaN(s.cumulativeRetentionPct as number)).toBe(false);
    }
  });

  it("flags an inverted funnel rather than reporting >100% retention", () => {
    // A step added mid-campaign legitimately out-reaches its predecessor.
    const funnel = build({
      steps: [step(1), step(2), step(3)],
      sends: [...sends("step-1", 10), ...sends("step-2", 8), ...sends("step-3", 12)],
    });

    expect(funnel.totals.hasInvertedStep).toBe(true);
    expect(funnel.steps[2].stepRetentionPct).toBeNull(); // not 150
  });

  it("does not flag inversion on a monotonically shrinking funnel", () => {
    const funnel = build({
      steps: [step(1), step(2)],
      sends: [...sends("step-1", 5), ...sends("step-2", 5)],
    });

    expect(funnel.totals.hasInvertedStep).toBe(false);
    expect(funnel.steps[1].stepRetentionPct).toBe(100);
  });
});

describe("buildCampaignFunnel — the two denominators", () => {
  it("counts a TASK step's SKIPPED rows as reach, so it is not a 100% cliff", () => {
    // engine.ts writes SKIPPED for every TASK step. If `reached` ignored those,
    // a mid-sequence reminder would read as total drop-off and step 3's
    // retention would be measured against zero.
    const funnel = build({
      steps: [step(1), step(2, { channel: "TASK" }), step(3)],
      sends: [
        ...sends("step-1", 10),
        ...sends("step-2", 10, { status: "SKIPPED" }),
        ...sends("step-3", 9),
      ],
    });

    const task = funnel.steps[1];
    expect(task.reached).toBe(10);
    expect(task.delivered).toBe(0);
    expect(task.taskLogged).toBe(10);
    expect(task.failed).toBe(0); // a TASK step is not a delivery failure
    expect(task.stepRetentionPct).toBe(100);
    expect(funnel.steps[2].stepRetentionPct).toBe(90); // 9 of 10, not 9 of 0
    expect(funnel.totals.failedTotal).toBe(0);
  });

  it("keeps FAILED sends in reach but out of the rate denominator", () => {
    // The cursor advances past a failed send, so those contacts DID continue.
    const funnel = build({
      steps: [step(1), step(2)],
      sends: [
        ...sends("step-1", 8, { openedAt: new Date() }),
        ...sends("step-1", 2, { status: "FAILED" }),
        ...sends("step-2", 10),
      ],
    });

    const first = funnel.steps[0];
    expect(first.reached).toBe(10);
    expect(first.delivered).toBe(8); // open/click rates divide by this
    expect(first.failed).toBe(2);
    expect(first.opened).toBe(8);
    expect(funnel.steps[1].stepRetentionPct).toBe(100); // 10 of 10, not 10 of 8
    expect(funnel.totals.failedTotal).toBe(2);
  });

  it("counts opens and clicks first-touch, only on delivered sends", () => {
    const opened = new Date("2026-08-01T00:00:00Z");
    const clicked = new Date("2026-08-02T00:00:00Z");
    const funnel = build({
      steps: [step(1)],
      sends: [
        ...sends("step-1", 3, { openedAt: opened, firstClickedAt: clicked }),
        ...sends("step-1", 2, { openedAt: opened }),
        ...sends("step-1", 5),
        // A FAILED row carrying stale timestamps must not inflate engagement.
        send("step-1", { status: "FAILED", openedAt: opened, firstClickedAt: clicked }),
      ],
    });

    expect(funnel.steps[0].delivered).toBe(10);
    expect(funnel.steps[0].opened).toBe(5);
    expect(funnel.steps[0].clicked).toBe(3);
  });
});

describe("buildCampaignFunnel — live position", () => {
  it("maps lastStepOrder N to the step awaiting order N+1", () => {
    // The single likeliest bug in this feature. lastStepOrder is what has
    // ALREADY been sent, so lastStepOrder: 2 means "waiting for step 3".
    const funnel = build({
      steps: [step(1), step(2), step(3), step(4)],
      enrollmentGroups: [group("ACTIVE", 0, 5), group("ACTIVE", 2, 3)],
    });

    expect(funnel.steps[0].waiting).toBe(5); // lastStepOrder 0 → nothing sent yet
    expect(funnel.steps[1].waiting).toBe(0);
    expect(funnel.steps[2].waiting).toBe(3); // lastStepOrder 2 → step 3, NOT step 2
    expect(funnel.steps[3].waiting).toBe(0);
    expect(funnel.totals.waitingTotal).toBe(8);
  });

  it("excludes completed and exited enrollments from every step's waiting count", () => {
    const funnel = build({
      steps: [step(1), step(2)],
      enrollmentGroups: [
        group("ACTIVE", 0, 4),
        group("COMPLETED", 2, 20),
        group("EXITED", 1, 7),
      ],
    });

    expect(funnel.steps[0].waiting).toBe(4);
    expect(funnel.steps[1].waiting).toBe(0);
    expect(funnel.totals.waitingTotal).toBe(4);
    expect(funnel.enrollmentCounts).toEqual({
      active: 4,
      completed: 20,
      exited: 7,
      paused: 0,
    });
  });

  it("tracks paused enrollments separately from waiting", () => {
    const funnel = build({
      steps: [step(1), step(2)],
      enrollmentGroups: [group("ACTIVE", 0, 3), group("PAUSED", 1, 6)],
    });

    expect(funnel.steps[0].waiting).toBe(3);
    expect(funnel.steps[0].paused).toBe(0);
    expect(funnel.steps[1].waiting).toBe(0);
    expect(funnel.steps[1].paused).toBe(6);
    expect(funnel.enrollmentCounts.paused).toBe(6);
  });

  it("drops a cursor pointing past the last step instead of inventing a phantom step", () => {
    // Steps can be deleted after sends exist.
    const funnel = build({
      steps: [step(1), step(2)],
      enrollmentGroups: [group("ACTIVE", 9, 4)],
    });

    expect(funnel.steps).toHaveLength(2);
    expect(funnel.steps.every((s) => s.waiting === 0)).toBe(true);
    expect(funnel.totals.waitingTotal).toBe(0);
  });
});

describe("buildCampaignFunnel — unsubscribes", () => {
  it("attributes an unsubscribe to the step of its originating send", () => {
    const s1 = send("step-1");
    const s2 = send("step-2");
    const funnel = build({
      steps: [step(1), step(2)],
      sends: [s1, s2],
      unsubscribedSendIds: [s2.id],
    });

    expect(funnel.steps[0].unsubscribed).toBe(0);
    expect(funnel.steps[1].unsubscribed).toBe(1);
    expect(funnel.totals.unsubscribedTotal).toBe(1);
  });

  it("ignores an orphaned send id rather than crashing", () => {
    // EmailEvent.dripSend is onDelete: SetNull, so orphans are real.
    const s1 = send("step-1");
    const funnel = build({
      steps: [step(1)],
      sends: [s1],
      unsubscribedSendIds: [s1.id, "deleted-send-id"],
    });

    expect(funnel.steps[0].unsubscribed).toBe(1);
    expect(funnel.totals.unsubscribedTotal).toBe(1);
  });
});

describe("buildCampaignFunnel — ordering", () => {
  it("sorts steps by order regardless of input order", () => {
    const funnel = build({
      steps: [step(3), step(1), step(2)],
      sends: [...sends("step-1", 6), ...sends("step-2", 4), ...sends("step-3", 2)],
    });

    expect(funnel.steps.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(funnel.steps.map((s) => s.reached)).toEqual([6, 4, 2]);
  });

  it("passes dueNow through untouched", () => {
    expect(build({ steps: [step(1)], dueNow: 12 }).totals.dueNow).toBe(12);
  });
});

// ── Loader: query shape and query COUNT ──────────────────────────────
// Prisma-touching tests use the house pattern from tests/unit/drip-cohorts.test.ts:
// capture call args at module scope, mock.module before a dynamic import, reset
// in beforeEach — so the `where` clause that was actually built is assertable.

const calls: Array<{ model: string; args: Record<string, unknown> }> = [];
let sendRows: Array<Record<string, unknown>> = [];
let groupRows: Array<Record<string, unknown>> = [];
let unsubRows: Array<Record<string, unknown>> = [];
let enrollmentRows: Array<Record<string, unknown>> = [];
let paymentRows: Array<Record<string, unknown>> = [];
let dueNowCount = 0;

mock.module("@/lib/prisma", () => ({
  default: {
    dripSend: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "dripSend.findMany", args });
        return sendRows;
      },
    },
    dripEnrollment: {
      groupBy: async (args: Record<string, unknown>) => {
        calls.push({ model: "dripEnrollment.groupBy", args });
        return groupRows;
      },
      count: async (args: Record<string, unknown>) => {
        calls.push({ model: "dripEnrollment.count", args });
        return dueNowCount;
      },
      // Feeds recovered-sales attribution: enrolled emails + when they enrolled.
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "dripEnrollment.findMany", args });
        return enrollmentRows;
      },
    },
    emailEvent: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "emailEvent.findMany", args });
        return unsubRows;
      },
    },
    payment: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "payment.findMany", args });
        return paymentRows;
      },
    },
  },
}));

const { getCampaignFunnel } = await import("@/lib/drip/funnel");

describe("getCampaignFunnel", () => {
  beforeEach(() => {
    calls.length = 0;
    sendRows = [];
    groupRows = [];
    unsubRows = [];
    enrollmentRows = [];
    paymentRows = [];
    dueNowCount = 0;
  });

  it("never filters sends by status — failures must stay visible", () => {
    // Guard against someone re-adding `status: "SENT"`, which is precisely what
    // made a wholly-failing step indistinguishable from an unpopular one.
    return getCampaignFunnel("camp-1", [step(1)]).then(() => {
      const call = calls.find((c) => c.model === "dripSend.findMany");
      const where = call?.args.where as Record<string, unknown>;
      expect(where).toEqual({ enrollment: { campaignId: "camp-1" } });
      expect(where).not.toHaveProperty("status");

      const select = call?.args.select as Record<string, boolean>;
      expect(select.id).toBe(true);
      expect(select.stepId).toBe(true);
      expect(select.status).toBe(true);
      expect(select.openedAt).toBe(true);
      expect(select.firstClickedAt).toBe(true);
    });
  });

  it("groups enrollments by status AND lastStepOrder, scoped to the campaign", async () => {
    await getCampaignFunnel("camp-1", [step(1)]);

    const call = calls.find((c) => c.model === "dripEnrollment.groupBy");
    expect(call?.args.by).toEqual(["status", "lastStepOrder"]);
    expect(call?.args.where).toEqual({ campaignId: "camp-1" });
  });

  it("counts due-now against the given clock", async () => {
    const now = new Date("2026-08-06T12:00:00Z");
    await getCampaignFunnel("camp-1", [step(1)], now);

    const call = calls.find((c) => c.model === "dripEnrollment.count");
    expect(call?.args.where).toEqual({
      campaignId: "camp-1",
      status: "ACTIVE",
      nextRunAt: { lte: now },
    });
  });

  it("reads unsubscribe events scoped to this campaign", async () => {
    await getCampaignFunnel("camp-1", [step(1)]);

    const call = calls.find((c) => c.model === "emailEvent.findMany");
    expect(call?.args.where).toEqual({
      type: "UNSUBSCRIBED",
      dripSend: { enrollment: { campaignId: "camp-1" } },
    });
  });

  it("issues a fixed number of queries regardless of step, send or buyer volume", async () => {
    // The executable form of "bounded by step count, not volume". If this ever
    // grows to N + per-step or per-buyer queries, someone has introduced a loop.
    // Six: sends, enrollment groupBy, due-now count, unsubscribes, plus the two
    // that attribute recovered sales (enrollments → their payments).
    sendRows = Array.from({ length: 500 }, (_, i) => ({
      id: `s${i}`,
      stepId: `step-${(i % 7) + 1}`,
      status: "SENT",
      openedAt: null,
      firstClickedAt: null,
    }));
    enrollmentRows = Array.from({ length: 200 }, (_, i) => ({
      enrolledAt: new Date("2026-08-01T00:00:00Z"),
      contact: { email: `buyer${i}@example.com` },
    }));
    paymentRows = Array.from({ length: 200 }, (_, i) => ({
      buyerEmail: `buyer${i}@example.com`,
      amount: 15000,
      createdAt: new Date("2026-08-02T00:00:00Z"),
    }));
    const sevenSteps = [1, 2, 3, 4, 5, 6, 7].map((order) => step(order));
    await getCampaignFunnel("camp-1", sevenSteps);
    expect(calls).toHaveLength(6);

    calls.length = 0;
    sendRows = [{ id: "s1", stepId: "step-1", status: "SENT", openedAt: null, firstClickedAt: null }];
    await getCampaignFunnel("camp-1", [step(1)]);
    expect(calls).toHaveLength(6);
  });

  // Recovered sales are the number this campaign exists to move, so the
  // attribution rules are pinned here rather than left to the reader.
  it("attributes only sales made after enrollment, once per buyer", async () => {
    enrollmentRows = [
      { enrolledAt: new Date("2026-08-05T00:00:00Z"), contact: { email: "late@example.com" } },
      { enrolledAt: new Date("2026-08-05T00:00:00Z"), contact: { email: "early@example.com" } },
      { enrolledAt: new Date("2026-08-05T00:00:00Z"), contact: { email: "repeat@example.com" } },
    ];
    paymentRows = [
      // After enrolling — counts.
      { buyerEmail: "late@example.com", amount: 15000, createdAt: new Date("2026-08-07T00:00:00Z") },
      // Before enrolling — that's WHY they're in a campaign, not a result of it.
      { buyerEmail: "early@example.com", amount: 99900, createdAt: new Date("2026-08-01T00:00:00Z") },
      // Two sales from one buyer count once, at their most recent.
      { buyerEmail: "repeat@example.com", amount: 50000, createdAt: new Date("2026-08-09T00:00:00Z") },
      { buyerEmail: "repeat@example.com", amount: 15000, createdAt: new Date("2026-08-08T00:00:00Z") },
    ];

    const funnel = await getCampaignFunnel("camp-1", [step(1)]);
    expect(funnel.recovered).toEqual({ buyers: 2, revenueCents: 65000 });
  });

  it("reports zero recovered sales when nobody is enrolled, without querying payments", async () => {
    const funnel = await getCampaignFunnel("camp-1", [step(1)]);
    expect(funnel.recovered).toEqual({ buyers: 0, revenueCents: 0 });
    expect(calls.find((c) => c.model === "payment.findMany")).toBeUndefined();
  });

  it("maps Prisma's _count shape into the pure builder's input", async () => {
    groupRows = [{ status: "ACTIVE", lastStepOrder: 1, _count: { _all: 4 } }];
    const funnel = await getCampaignFunnel("camp-1", [step(1), step(2)]);

    expect(funnel.steps[1].waiting).toBe(4);
    expect(funnel.enrollmentCounts.active).toBe(4);
  });

  it("drops null dripSendIds from unsubscribe events", async () => {
    sendRows = [{ id: "s1", stepId: "step-1", status: "SENT", openedAt: null, firstClickedAt: null }];
    unsubRows = [{ dripSendId: "s1" }, { dripSendId: null }];

    const funnel = await getCampaignFunnel("camp-1", [step(1)]);
    expect(funnel.steps[0].unsubscribed).toBe(1);
  });
});
