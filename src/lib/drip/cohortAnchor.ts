// src/lib/drip/cohortAnchor.ts
// Cohort-anchored drip scheduling: turns a Cohort row into an absolute start
// instant, computes when a COHORT_START step is due, and builds the cohort
// merge context ({{cohort_name}}, {{zoom_link}}, ...) for reminder emails.
//
// Kept separate from engine.ts so the fire-point routes (Stripe webhook,
// register-free, self-enroll) can import `enrollInCohortReminderCampaigns`
// without dragging the whole runtime along.

import prisma from "@/lib/prisma";
import { resolveIanaZone, sessionInterval } from "@/lib/sessionInstant";
import { nextUpcomingSession, type SessionForJoin } from "@/lib/freeSeat";
import { resolveJoinLink } from "@/lib/sessionLink";
import { parseTags } from "./segment";
import { logger } from "@/lib/logger";

// Re-exported, not redefined: constants.ts is the single source of truth (it is
// the one module a "use client" component may import — see its header). Two
// copies of these strings is how a trigger filter silently stops matching.
import { COHORT_TRIGGER } from "./constants";
export { COHORT_TRIGGER, LEAD_TRIGGER, BROADCAST_TRIGGER, CAMPAIGN_TRIGGERS } from "./constants";

export const STEP_ANCHORS = ["ENROLLMENT", "COHORT_START"] as const;
export type StepAnchor = (typeof STEP_ANCHORS)[number];

/** Tag stamped on every Contact registered for a cohort: `cohort:<slug-or-id>`. */
export function cohortTag(cohort: { slug: string | null; id: string }): string {
  return `cohort:${cohort.slug || cohort.id}`;
}

export type CohortForAnchor = {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  deliveryMode: string;
  location: string | null;
  zoomLink: string | null;
  startDate: Date | null;
  startTime: string | null;
  timezone: string;
  sessions?: Array<{
    id?: string;
    date: Date;
    startTime: string;
    endTime: string;
    timezone: string | null;
    meetingLink?: string | null;
  }>;
};

export const COHORT_ANCHOR_SELECT = {
  id: true,
  slug: true,
  title: true,
  status: true,
  deliveryMode: true,
  location: true,
  zoomLink: true,
  startDate: true,
  startTime: true,
  timezone: true,
  sessions: {
    orderBy: { date: "asc" as const },
    // The anchor is the next session that has not finished, so one row is not
    // enough: a cohort mid-run needs the whole remaining schedule in hand.
    take: 60,
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      timezone: true,
      meetingLink: true,
    },
  },
} as const;

/**
 * The cohort's first-class start moment as a UTC instant, or null when the row
 * doesn't carry enough to say ("cannot reason about this cohort's time" — the
 * campaign simply never fires for it, mirroring sessionInterval's contract).
 *
 * Prefers cohort-level startDate + startTime (wall clock in the cohort's zone,
 * same dual-shape handling the instructor reminders trust); otherwise anchors on
 * the NEXT session that has not finished yet. Never on the first session ever:
 * for a recurring cohort that first session is in the past, and anchoring there
 * made every COHORT_START step permanently stale.
 */
export function cohortStartInstant(
  cohort: CohortForAnchor,
  now: Date = new Date()
): Date | null {
  if (cohort.startDate && !Number.isNaN(cohort.startDate.getTime())) {
    const zone = resolveIanaZone(cohort.timezone);
    if (cohort.startTime) {
      // Reuse sessionInterval's wall-clock/ISO handling by shaping the cohort
      // fields like a session row (endTime unused — one-hour fallback kicks in).
      const interval = sessionInterval({
        date: cohort.startDate,
        startTime: cohort.startTime,
        endTime: cohort.startTime,
        timezone: zone,
      });
      if (interval) return interval.startUtc;
    }
    // Date without a parseable time: assume 9am local rather than UTC midnight,
    // so T-2h never fires mid-evening the day before.
    const interval = sessionInterval({
      date: cohort.startDate,
      startTime: "9:00 AM",
      endTime: "10:00 AM",
      timezone: zone,
    });
    if (interval) return interval.startUtc;
  }

  const next = upcomingAnchorSession(cohort, now);
  if (next) {
    const interval = sessionInterval(next);
    if (interval) return interval.startUtc;
  }
  return null;
}

type AnchorSession = NonNullable<CohortForAnchor["sessions"]>[number];

/**
 * The cohort's next unfinished session, normalized to the shape
 * `nextUpcomingSession` works on (id/meetingLink are optional on the anchor
 * select's older callers, required on SessionForJoin).
 */
function upcomingAnchorSession(
  cohort: CohortForAnchor,
  now: Date
): (AnchorSession & SessionForJoin) | null {
  const sessions = (cohort.sessions ?? []).map((session) => ({
    ...session,
    id: session.id ?? "",
    meetingLink: session.meetingLink ?? null,
  }));
  return nextUpcomingSession(sessions, now);
}

/** Default missed-window grace for cohort-anchored steps. */
export const COHORT_STEP_GRACE_MS = 45 * 60_000;

/**
 * Whether a cohort-anchored step is too stale to send.
 *
 * Three ways a step goes stale: its cohort start stopped resolving, its moment
 * passed more than the grace window ago, or the class already started. The
 * fourth — `due` now sits well AFTER the moment the step was scheduled for —
 * catches an anchor that moved forward (the next session rolled over) since the
 * cursor was written, where the old wording would happily send "starting in two
 * hours" a week early.
 */
export function isCohortStepStale(args: {
  due: Date | null;
  cohortStart: Date | null;
  now: Date;
  scheduledFor?: Date | null;
  graceMs?: number;
}): boolean {
  const graceMs = args.graceMs ?? COHORT_STEP_GRACE_MS;
  if (!args.due) return true;
  if (args.now.getTime() > args.due.getTime() + graceMs) return true;
  if (args.cohortStart && args.now.getTime() > args.cohortStart.getTime()) return true;
  if (
    args.scheduledFor &&
    args.due.getTime() - args.scheduledFor.getTime() > graceMs
  ) {
    return true;
  }
  return false;
}

/** When a step is due: absolute for COHORT_START, enrollment-relative otherwise. */
export function stepDueAt(
  step: { anchor: string; offsetMinutes: number; delayHours: number },
  cohortStart: Date | null,
  enrolledAt: Date
): Date | null {
  if (step.anchor === "COHORT_START") {
    if (!cohortStart) return null;
    return new Date(cohortStart.getTime() + step.offsetMinutes * 60_000);
  }
  const hours = Number.isFinite(step.delayHours) ? Math.max(0, step.delayHours) : 0;
  return new Date(enrolledAt.getTime() + hours * 3_600_000);
}

/** Merge-context slice for cohort reminder emails, formatted in the cohort's zone. */
export function cohortMergeContext(
  cohort: CohortForAnchor,
  startInstant: Date | null,
  baseAppUrl: string,
  now: Date = new Date()
): {
  cohortTitle: string;
  cohortStartDate?: string;
  cohortStartTime?: string;
  zoomLink?: string;
  venueAddress?: string;
  cohortUrl: string;
} {
  const zone = resolveIanaZone(cohort.timezone);
  let cohortStartDate: string | undefined;
  let cohortStartTime: string | undefined;
  if (startInstant) {
    cohortStartDate = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(startInstant);
    cohortStartTime = `${new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(startInstant)} ${zoneAbbreviation(startInstant, zone)}`;
  }
  // The link a student clicks is the NEXT session's, not the cohort-wide one —
  // resolveJoinLink already falls back to cohort.zoomLink when the session
  // carries none.
  const upcoming = upcomingAnchorSession(cohort, now);
  const zoomLink = upcoming
    ? (resolveJoinLink({ meetingLink: upcoming.meetingLink, cohort }) ?? undefined)
    : (cohort.zoomLink ?? undefined);

  const showVenue =
    cohort.deliveryMode === "INPERSON" || cohort.deliveryMode === "HYBRID";
  return {
    cohortTitle: cohort.title,
    cohortStartDate,
    cohortStartTime,
    zoomLink,
    venueAddress: showVenue ? (cohort.location ?? undefined) : undefined,
    cohortUrl: `${baseAppUrl}/cohorts/${cohort.slug || cohort.id}`,
  };
}

function zoneAbbreviation(instant: Date, zone: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
  })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

// ─── Enrollment creation (shared by fire points and the tick sweep) ──

/**
 * Initial cursor for a fresh cohort enrollment: skip past every COHORT_START
 * step already due (a T-3h signup must get welcome + T-2h, not a stale T-7d),
 * and compute when the first pending step runs. ENROLLMENT-anchored steps are
 * never pre-skipped. Returns null when nothing remains to send.
 */
export function initialCursor(
  steps: Array<{ order: number; anchor: string; offsetMinutes: number; delayHours: number }>,
  cohortStart: Date | null,
  now: Date,
  options: { skipWelcome?: boolean } = {}
): { lastStepOrder: number; nextRunAt: Date } | null {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  let lastStepOrder = 0;
  for (const step of ordered) {
    const isWelcome = step.anchor !== "COHORT_START";
    if (isWelcome) {
      if (options.skipWelcome) {
        lastStepOrder = step.order;
        continue;
      }
      return { lastStepOrder, nextRunAt: stepDueAt(step, cohortStart, now) ?? now };
    }
    const due = stepDueAt(step, cohortStart, now);
    if (!due) return null; // Unresolvable cohort start — nothing to schedule.
    if (due.getTime() <= now.getTime()) {
      lastStepOrder = step.order; // Already in the past — pre-skip.
      continue;
    }
    return { lastStepOrder, nextRunAt: due };
  }
  return null;
}

export async function ensureContactForUser(
  email: string,
  name: string | null,
  options: { source: string; tags?: string[]; now?: Date }
): Promise<{
  id: string;
  unsubscribedAt: Date | null;
  courseEmailOptOutAt: Date | null;
} | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const now = options.now ?? new Date();
  const existing = await prisma.contact.findUnique({
    where: { email: normalizedEmail },
    select: { tags: true },
  });
  const tags = new Set(parseTags(existing?.tags ?? null));
  for (const tag of options.tags ?? []) tags.add(tag);

  return prisma.contact.upsert({
    where: { email: normalizedEmail },
    // Tag-add only on update: attribution, source, status and name belong to
    // the lead pipeline and must survive provisioning untouched. On create,
    // the caller records why the Contact was provisioned, but provisioning is
    // not evidence of a purchase; only the purchase pipeline may promote WON.
    update: { tags: JSON.stringify([...tags]), lastActivityAt: now },
    create: {
      email: normalizedEmail,
      name: name?.trim() || "Guest",
      status: "NEW",
      source: options.source,
      tags: JSON.stringify([...tags]),
      lastActivityAt: now,
    },
    select: { id: true, unsubscribedAt: true, courseEmailOptOutAt: true },
  });
}

/**
 * Register one person into every ACTIVE COHORT_SCHEDULE campaign for `cohortId`:
 * upserts the Contact by email (tag-add only — never clobbers lead attribution)
 * and creates the cohort-scoped DripEnrollment with skip-past-due semantics.
 *
 * Best-effort by contract: called from fulfillment paths (Stripe webhook,
 * register-free) where a drip failure must never break the purchase — callers
 * get a boolean, not an exception. The tick sweep is the safety net for anyone
 * this misses.
 */
export async function enrollInCohortReminderCampaigns(
  email: string,
  name: string | null,
  cohortId: string,
  options: { skipWelcome?: boolean; now?: Date } = {}
): Promise<boolean> {
  try {
    const now = options.now ?? new Date();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return false;

    const campaigns = await prisma.dripCampaign.findMany({
      where: { status: "ACTIVE", trigger: COHORT_TRIGGER },
      include: {
        steps: {
          orderBy: { order: "asc" },
          select: { order: true, anchor: true, offsetMinutes: true, delayHours: true },
        },
      },
    });
    if (!campaigns.length) return false;

    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: COHORT_ANCHOR_SELECT,
    });
    if (!cohort) return false;
    const start = cohortStartInstant(cohort, now);
    if (start && start.getTime() < now.getTime()) return false; // Already started.

    const tag = cohortTag(cohort);
    const contact = await ensureContactForUser(normalizedEmail, name, {
      source: "cohort-enrollment",
      tags: [tag],
      now,
    });
    // No email-consent gate here: a course email opt-out only skips the EMAIL
    // steps at send time, so reminder texts still reach SMS-consented students.
    if (!contact) return false;

    let created = false;
    for (const campaign of campaigns) {
      if (!campaign.steps.length) continue;
      const cursor = initialCursor(campaign.steps, start, now, {
        skipWelcome: options.skipWelcome,
      });
      if (!cursor) continue;
      try {
        await prisma.dripEnrollment.create({
          data: {
            campaignId: campaign.id,
            contactId: contact.id,
            cohortId: cohort.id,
            status: "ACTIVE",
            lastStepOrder: cursor.lastStepOrder,
            enrolledAt: now,
            nextRunAt: cursor.nextRunAt,
          },
        });
        created = true;
      } catch {
        // Unique-constraint race or already enrolled — fine.
      }
    }
    return created;
  } catch (error) {
    logger.error({ err: error }, "[drip] cohort reminder enrollment failed (non-fatal):");
    return false;
  }
}
