// src/lib/instructorReminders.ts
//
// Automated instructor mail: chase people who haven't answered a schedule proposal,
// and remind confirmed instructors before they have to show up and teach.
//
// Same safety model as the drip engine: due work is derived from the database on
// every tick, and a unique InstructorReminderSend row — not caller discipline — is
// what stops a double send. Ticking twice in a row is a no-op.

import prisma from "@/lib/prisma";
import { sendMail, isMailConfigured } from "@/lib/mail";
import { DRIP_FROM, DRIP_REPLY_TO } from "@/lib/drip/template";
import { logger } from "@/lib/logger";
import { sessionInterval } from "@/lib/sessionInstant";
import { renderNudgeEmail, renderSessionReminderEmail } from "@/lib/instructorOutreach";

/** Nudge an unanswered proposal after 3 days, once more after 7, then leave them alone. */
const NUDGE_1_DAYS = 3;
const NUDGE_2_DAYS = 7;
/** Pre-session reminders. */
const REMINDER_WINDOWS = [
  { kind: "SESSION_T72" as const, hours: 72 },
  { kind: "SESSION_T24" as const, hours: 24 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderTickResult = {
  nudges: { sent: number; skipped: number; failed: number };
  sessionReminders: { sent: number; skipped: number; failed: number };
  smtpConfigured: boolean;
};

type SendOutcome = "SENT" | "SKIPPED" | "FAILED";

/**
 * Record-then-send is deliberate: the unique row is claimed first, so a concurrent
 * tick loses the race and skips rather than sending a duplicate.
 */
async function sendOnce(
  key: { cohortInstructorId: string; kind: string; sessionId?: string },
  to: string,
  subject: string,
  html: string
): Promise<SendOutcome> {
  const sessionId = key.sessionId ?? "";
  const existing = await prisma.instructorReminderSend.findUnique({
    where: {
      cohortInstructorId_kind_sessionId: {
        cohortInstructorId: key.cohortInstructorId,
        kind: key.kind,
        sessionId,
      },
    },
    select: { id: true },
  });
  if (existing) return "SKIPPED";

  const smtp = await isMailConfigured();
  if (!smtp) {
    await prisma.instructorReminderSend.create({
      data: { cohortInstructorId: key.cohortInstructorId, kind: key.kind, sessionId, status: "SKIPPED", error: "SMTP not configured" },
    });
    logger.info({ to, subject }, "[instructorReminders] SKIPPED (no SMTP)");
    return "SKIPPED";
  }

  try {
    await sendMail({ to, subject, html, from: DRIP_FROM, replyTo: DRIP_REPLY_TO });
    await prisma.instructorReminderSend.create({
      data: { cohortInstructorId: key.cohortInstructorId, kind: key.kind, sessionId, status: "SENT" },
    });
    return "SENT";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.instructorReminderSend.create({
      data: { cohortInstructorId: key.cohortInstructorId, kind: key.kind, sessionId, status: "FAILED", error: message },
    });
    logger.error({ err, to }, "[instructorReminders] send failed");
    return "FAILED";
  }
}

function tallyInto(bucket: { sent: number; skipped: number; failed: number }, outcome: SendOutcome) {
  if (outcome === "SENT") bucket.sent++;
  else if (outcome === "SKIPPED") bucket.skipped++;
  else bucket.failed++;
}

export async function tick(now = new Date()): Promise<ReminderTickResult> {
  const result: ReminderTickResult = {
    nudges: { sent: 0, skipped: 0, failed: 0 },
    sessionReminders: { sent: 0, skipped: 0, failed: 0 },
    smtpConfigured: await isMailConfigured(),
  };

  // ── 1. Proposal nudges ────────────────────────────────────────────────
  const pending = await prisma.cohortInstructor.findMany({
    where: {
      status: "PENDING",
      invitedAt: { not: null, lte: new Date(now.getTime() - NUDGE_1_DAYS * DAY_MS) },
      cohort: { status: { in: ["ENROLLMENT", "IN_PROGRESS"] } },
    },
    select: {
      id: true,
      invitedAt: true,
      responseToken: true,
      cohort: { select: { title: true, startDate: true, endDate: true } },
      instructor: { select: { name: true, email: true, scheduleToken: true } },
    },
  });

  for (const record of pending) {
    const ageMs = now.getTime() - (record.invitedAt?.getTime() ?? now.getTime());
    const kind = ageMs >= NUDGE_2_DAYS * DAY_MS ? "PROPOSAL_NUDGE_2" : "PROPOSAL_NUDGE_1";
    const { subject, html } = renderNudgeEmail({
      instructorName: record.instructor.name,
      instructorEmail: record.instructor.email,
      cohortTitle: record.cohort.title,
      cohortStart: record.cohort.startDate,
      cohortEnd: record.cohort.endDate,
      scheduleToken: record.instructor.scheduleToken,
      responseToken: record.responseToken,
      isSecondNudge: kind === "PROPOSAL_NUDGE_2",
    });
    tallyInto(
      result.nudges,
      await sendOnce({ cohortInstructorId: record.id, kind }, record.instructor.email, subject, html)
    );
  }

  // ── 2. Pre-session reminders for confirmed teaching ───────────────────
  const confirmed = await prisma.sessionAssignment.findMany({
    where: { status: "CONFIRMED" },
    select: {
      id: true,
      cohortInstructorId: true,
      session: {
        select: {
          id: true,
          title: true,
          date: true,
          startTime: true,
          endTime: true,
          timezone: true,
          meetingLink: true,
          cohort: { select: { title: true, location: true } },
        },
      },
      cohortInstructor: {
        select: { instructor: { select: { name: true, email: true, scheduleToken: true } } },
      },
    },
  });

  for (const assignment of confirmed) {
    const interval = sessionInterval(assignment.session);
    if (!interval) continue;
    const msUntil = interval.startUtc.getTime() - now.getTime();
    if (msUntil <= 0) continue;

    for (const window of REMINDER_WINDOWS) {
      if (msUntil > window.hours * 60 * 60 * 1000) continue;
      const { subject, html } = renderSessionReminderEmail({
        instructorName: assignment.cohortInstructor.instructor.name,
        instructorEmail: assignment.cohortInstructor.instructor.email,
        cohortTitle: assignment.session.cohort.title,
        sessionTitle: assignment.session.title,
        startUtc: interval.startUtc,
        endUtc: interval.endUtc,
        ianaTz: interval.ianaTz,
        location: assignment.session.cohort.location,
        meetingLink: assignment.session.meetingLink,
        scheduleToken: assignment.cohortInstructor.instructor.scheduleToken,
        hoursAhead: window.hours,
      });
      tallyInto(
        result.sessionReminders,
        await sendOnce(
          { cohortInstructorId: assignment.cohortInstructorId, kind: window.kind, sessionId: assignment.session.id },
          assignment.cohortInstructor.instructor.email,
          subject,
          html
        )
      );
      // Only the tightest matching window fires per tick; the wider one is either
      // already recorded or will be skipped by its own unique row next time.
      break;
    }
  }

  logger.info({ ...result }, "[instructorReminders] tick complete");
  return result;
}

/** Counts for the monitoring GET — what the next tick would consider. */
export async function reminderQueueDepth(now = new Date()) {
  const nudgeCandidates = await prisma.cohortInstructor.count({
    where: {
      status: "PENDING",
      invitedAt: { not: null, lte: new Date(now.getTime() - NUDGE_1_DAYS * DAY_MS) },
      cohort: { status: { in: ["ENROLLMENT", "IN_PROGRESS"] } },
    },
  });
  const confirmedAssignments = await prisma.sessionAssignment.count({ where: { status: "CONFIRMED" } });
  const changeRequests = await prisma.sessionAssignment.count({ where: { status: "CHANGE_REQUESTED" } });
  const sends = await prisma.instructorReminderSend.groupBy({ by: ["status"], _count: { _all: true } });
  return {
    nudgeCandidates,
    confirmedAssignments,
    changeRequests,
    sends: Object.fromEntries(sends.map((s) => [s.status, s._count._all])),
  };
}
