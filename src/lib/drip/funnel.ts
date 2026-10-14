// src/lib/drip/funnel.ts
// Per-step funnel stats for the campaign admin: where contacts are, where the
// sequence leaks, and whether anything is broken.
//
// Three engine semantics drive every decision in this file. Each one inverts
// the obvious implementation, so they're stated here rather than rediscovered:
//
//  1. **SKIPPED is not a failure.** engine.ts's only writer is
//     `status: step.channel === "TASK" ? "SKIPPED" : "SENT"` — it means "this
//     was an internal reminder, no mail was intended". Counting it as a delivery
//     error would paint a permanent red number on every TASK step and teach the
//     reader to ignore red.
//  2. **The enrollment cursor advances regardless of send outcome** (engine.ts,
//     "Advance the cursor regardless of send outcome"). A contact whose step
//     FAILED, or who hit a TASK step, still moves on. So a drop-off chain built
//     on SENT-only counts reads every TASK step as a 100% cliff and every FAILED
//     step as >100% retention at the next step.
//  3. **Unsubscribe attribution is last-send-wins and cross-campaign**
//     (engine.ts attributes to `dripSend.findFirst({ where: { contactId } })`
//     with no campaign filter). Directionally useful, not exact — the UI says so.
//
// Consequence: two denominators, never one.
//   reached   = SENT + FAILED + SKIPPED — "the sequence got here". Drop-off and
//               retention measure against this.
//   delivered = SENT only — the honest denominator for open/click/unsub rates.

import prisma from "@/lib/prisma";

export type FunnelStepInput = {
  id: string;
  order: number;
  channel: string;
};

export type FunnelSendInput = {
  id: string;
  stepId: string;
  status: string;
  openedAt: Date | null;
  firstClickedAt: Date | null;
};

export type FunnelEnrollmentGroup = {
  status: string;
  lastStepOrder: number;
  count: number;
};

export type StepFunnel = {
  order: number;
  /** SENT + FAILED + SKIPPED — how many passed through this step at all. */
  reached: number;
  /** SENT only — the denominator for every rate below. */
  delivered: number;
  failed: number;
  /** SKIPPED: a TASK-channel step (internal reminder, not an error), or a CALL
   *  step withheld because the lead wasn't callable (no consent / DNC / bad phone). */
  taskLogged: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  /** ACTIVE enrollments parked here awaiting this step's send. */
  waiting: number;
  paused: number;
  /** reached(N) / reached(N-1). Null for step 1, and whenever it can't be trusted. */
  stepRetentionPct: number | null;
  /** reached(N) / reached(first step). Null when the first step has no reach. */
  cumulativeRetentionPct: number | null;
};

export type CampaignFunnel = {
  steps: StepFunnel[];
  totals: {
    waitingTotal: number;
    dueNow: number;
    failedTotal: number;
    unsubscribedTotal: number;
    /**
     * True when a later step out-reaches an earlier one. Legitimate — steps can
     * be added or reordered mid-flight (DripStep's unique is on
     * [campaignId, order], so order is mutable while sends bind to stepId) — so
     * the UI renders the affected ratio as "—" and explains, rather than
     * clamping to a plausible-looking lie.
     */
    hasInvertedStep: boolean;
  };
  /** Enrollment status counts, derived from the same groupBy as `waiting`. */
  enrollmentCounts: {
    active: number;
    completed: number;
    exited: number;
    paused: number;
  };
  /**
   * Sales made by enrolled contacts AFTER they enrolled. This is post-enrollment
   * attribution, not proof of causation — someone who would have bought anyway
   * still counts here. It is the number worth watching for cart recovery, where
   * the whole campaign exists to convert a specific started checkout.
   */
  recovered: {
    buyers: number;
    revenueCents: number;
  };
};

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Pure funnel math. No Prisma, no clock — every input is passed in, so the
 * off-by-one on `lastStepOrder` and the TASK/FAILED denominator split are
 * directly testable without a database.
 */
export function buildCampaignFunnel(input: {
  steps: FunnelStepInput[];
  sends: FunnelSendInput[];
  enrollmentGroups: FunnelEnrollmentGroup[];
  unsubscribedSendIds: string[];
  dueNow: number;
  recovered?: { buyers: number; revenueCents: number };
}): CampaignFunnel {
  const { steps, sends, enrollmentGroups, unsubscribedSendIds, dueNow } = input;
  const recovered = input.recovered ?? { buyers: 0, revenueCents: 0 };
  const ordered = [...steps].sort((a, b) => a.order - b.order);

  // sendId → stepId, so unsubscribe events (which only know their DripSend)
  // can be attributed to a step without a second query.
  const stepIdBySendId = new Map<string, string>();
  for (const send of sends) stepIdBySendId.set(send.id, send.stepId);

  const unsubByStepId = new Map<string, number>();
  for (const sendId of unsubscribedSendIds) {
    const stepId = stepIdBySendId.get(sendId);
    // EmailEvent.dripSend is onDelete: SetNull, so orphaned ids are real.
    // Drop them rather than inventing a step to hang them on.
    if (!stepId) continue;
    unsubByStepId.set(stepId, (unsubByStepId.get(stepId) ?? 0) + 1);
  }

  type Tally = {
    reached: number;
    delivered: number;
    failed: number;
    taskLogged: number;
    opened: number;
    clicked: number;
  };
  const tallyByStepId = new Map<string, Tally>();
  const blank = (): Tally => ({
    reached: 0,
    delivered: 0,
    failed: 0,
    taskLogged: 0,
    opened: 0,
    clicked: 0,
  });

  for (const send of sends) {
    const tally = tallyByStepId.get(send.stepId) ?? blank();
    tally.reached += 1; // every row counts — that's the point of `reached`
    if (send.status === "SENT") {
      tally.delivered += 1;
      if (send.openedAt) tally.opened += 1;
      if (send.firstClickedAt) tally.clicked += 1;
    } else if (send.status === "FAILED") {
      tally.failed += 1;
    } else if (send.status === "SKIPPED") {
      tally.taskLogged += 1;
    }
    tallyByStepId.set(send.stepId, tally);
  }

  // `lastStepOrder` is what has ALREADY been sent, so a contact awaiting step N
  // sits at lastStepOrder === N - 1. This off-by-one is the likeliest bug in the
  // whole feature; it's asserted directly in the tests.
  const waitingByOrder = new Map<number, number>();
  const pausedByOrder = new Map<number, number>();
  const enrollmentCounts = { active: 0, completed: 0, exited: 0, paused: 0 };

  for (const group of enrollmentGroups) {
    const awaitingOrder = group.lastStepOrder + 1;
    if (group.status === "ACTIVE") {
      enrollmentCounts.active += group.count;
      waitingByOrder.set(awaitingOrder, (waitingByOrder.get(awaitingOrder) ?? 0) + group.count);
    } else if (group.status === "PAUSED") {
      enrollmentCounts.paused += group.count;
      pausedByOrder.set(awaitingOrder, (pausedByOrder.get(awaitingOrder) ?? 0) + group.count);
    } else if (group.status === "COMPLETED") {
      enrollmentCounts.completed += group.count;
    } else if (group.status === "EXITED") {
      enrollmentCounts.exited += group.count;
    }
  }

  const firstReached = ordered.length
    ? (tallyByStepId.get(ordered[0].id)?.reached ?? 0)
    : 0;

  let hasInvertedStep = false;
  const stepFunnels: StepFunnel[] = ordered.map((step, index) => {
    const tally = tallyByStepId.get(step.id) ?? blank();
    const previousReached =
      index === 0 ? null : (tallyByStepId.get(ordered[index - 1].id)?.reached ?? 0);

    // A step out-reaching its predecessor means the step set changed after
    // sending began. Report the anomaly instead of a >100% retention figure.
    const inverted = previousReached !== null && tally.reached > previousReached;
    if (inverted) hasInvertedStep = true;

    return {
      order: step.order,
      reached: tally.reached,
      delivered: tally.delivered,
      failed: tally.failed,
      taskLogged: tally.taskLogged,
      opened: tally.opened,
      clicked: tally.clicked,
      unsubscribed: unsubByStepId.get(step.id) ?? 0,
      // Enrollments whose cursor points past the last step aren't waiting for
      // anything that exists; they simply don't appear against any step.
      waiting: waitingByOrder.get(step.order) ?? 0,
      paused: pausedByOrder.get(step.order) ?? 0,
      stepRetentionPct: inverted ? null : previousReached === null ? null : ratio(tally.reached, previousReached),
      cumulativeRetentionPct: ratio(tally.reached, firstReached),
    };
  });

  return {
    steps: stepFunnels,
    totals: {
      waitingTotal: stepFunnels.reduce((sum, s) => sum + s.waiting, 0),
      dueNow,
      failedTotal: stepFunnels.reduce((sum, s) => sum + s.failed, 0),
      unsubscribedTotal: stepFunnels.reduce((sum, s) => sum + s.unsubscribed, 0),
      hasInvertedStep,
    },
    enrollmentCounts,
    recovered,
  };
}

/**
 * Post-enrollment sales for a campaign's contacts.
 *
 * A sale counts when the buyer's email matches an enrolled contact and the
 * payment was created at or after they enrolled. Payments made BEFORE
 * enrollment are excluded — those are the reason someone is in a campaign, not
 * a result of it. One payment per buyer email is counted (their most recent),
 * so a repeat customer can't inflate the recovery rate.
 */
async function getRecoveredSales(campaignId: string): Promise<{
  buyers: number;
  revenueCents: number;
}> {
  const enrollments = await prisma.dripEnrollment.findMany({
    where: { campaignId },
    select: { enrolledAt: true, contact: { select: { email: true } } },
  });
  if (enrollments.length === 0) return { buyers: 0, revenueCents: 0 };

  // Earliest enrollment per email: a contact re-enrolled later shouldn't lose
  // credit for a sale that followed their first pass through the campaign.
  const enrolledAtByEmail = new Map<string, Date>();
  for (const enrollment of enrollments) {
    const email = enrollment.contact?.email?.trim().toLowerCase();
    if (!email) continue;
    const existing = enrolledAtByEmail.get(email);
    if (!existing || enrollment.enrolledAt < existing) {
      enrolledAtByEmail.set(email, enrollment.enrolledAt);
    }
  }
  if (enrolledAtByEmail.size === 0) return { buyers: 0, revenueCents: 0 };

  const payments = await prisma.payment.findMany({
    where: { status: "paid", buyerEmail: { in: [...enrolledAtByEmail.keys()] } },
    orderBy: { createdAt: "desc" },
    select: { buyerEmail: true, amount: true, createdAt: true },
  });

  const counted = new Set<string>();
  let revenueCents = 0;
  for (const payment of payments) {
    const email = payment.buyerEmail?.trim().toLowerCase();
    if (!email || counted.has(email)) continue;
    const enrolledAt = enrolledAtByEmail.get(email);
    if (!enrolledAt || payment.createdAt < enrolledAt) continue;
    counted.add(email);
    revenueCents += payment.amount;
  }

  return { buyers: counted.size, revenueCents };
}

/**
 * Load and build the funnel for one campaign.
 *
 * Four queries, always — bounded by step count, never by send or enrollment
 * volume. Deliberately NOT the N-paired-count() pattern from the campaign LIST
 * page: that workaround exists because that page needs every campaign at once,
 * which isn't this page's problem. One findMany plus an in-memory rollup is the
 * cheaper idiom and is already what this page did for engagement.
 */
export async function getCampaignFunnel(
  campaignId: string,
  steps: FunnelStepInput[],
  now: Date = new Date()
): Promise<CampaignFunnel> {
  const [sends, enrollmentGroups, dueNow, unsubEvents, recovered] = await Promise.all([
    // No `status` filter, on purpose. Filtering to SENT here is what made a step
    // failing for every recipient look identical to a step nobody opened.
    prisma.dripSend.findMany({
      where: { enrollment: { campaignId } },
      select: {
        id: true,
        stepId: true,
        status: true,
        openedAt: true,
        firstClickedAt: true,
      },
    }),
    // campaignId is a real column on DripEnrollment, so groupBy works here —
    // unlike DripSend, where it would have to cross the enrollment relation.
    prisma.dripEnrollment.groupBy({
      by: ["status", "lastStepOrder"],
      where: { campaignId },
      _count: { _all: true },
    }),
    // Non-zero at page render means the tick isn't running.
    prisma.dripEnrollment.count({
      where: { campaignId, status: "ACTIVE", nextRunAt: { lte: now } },
    }),
    prisma.emailEvent.findMany({
      where: { type: "UNSUBSCRIBED", dripSend: { enrollment: { campaignId } } },
      select: { dripSendId: true },
    }),
    getRecoveredSales(campaignId),
  ]);

  return buildCampaignFunnel({
    steps,
    sends,
    enrollmentGroups: enrollmentGroups.map((group) => ({
      status: group.status,
      lastStepOrder: group.lastStepOrder,
      count: group._count._all,
    })),
    unsubscribedSendIds: unsubEvents
      .map((event) => event.dripSendId)
      .filter((id): id is string => id !== null),
    dueNow,
    recovered,
  });
}
