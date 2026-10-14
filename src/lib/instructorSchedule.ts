// src/lib/instructorSchedule.ts
//
// The v2 scheduling domain: what an instructor is being asked to teach across every
// upcoming cohort, where those asks clash, where a day cohort and an evening cohort
// could be combined into one full teaching day, and the negotiation moves both sides
// can make. v1 (src/lib/instructorParticipation.ts) still owns the per-cohort
// "will you teach this at all?" question; this owns per-session times.

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { TRACKED_COHORT_STATUSES } from "@/lib/instructorParticipation";
import { sessionInterval, intervalsOverlap, localDateKey, localMinuteOfDay } from "@/lib/sessionInstant";
import { syncCohortSessionToGcal } from "@/lib/googleCalendar";

export type AssignmentStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "CHANGE_REQUESTED"
  | "COUNTERED"
  | "DECLINED"
  | "CONFIRMED";

/** A session that runs past this hour (in its own zone) counts as an evening class. */
const EVENING_START_MINUTE = 17 * 60; // 5:00 PM

export type ScheduleSession = {
  assignmentId: string | null;
  sessionId: string;
  cohortId: string;
  cohortTitle: string;
  title: string;
  startUtc: string | null;
  endUtc: string | null;
  timezone: string;
  /** YYYY-MM-DD in the session's own zone — the grouping key for the calendar UI. */
  dateKey: string | null;
  status: AssignmentStatus | "UNASSIGNED";
  note: string | null;
  adminNote: string | null;
  proposedDate: string | null;
  proposedStartTime: string | null;
  proposedEndTime: string | null;
  /** Another session this instructor is booked for overlaps this one. */
  conflictsWith: string[];
  isEvening: boolean;
};

export type FullDayOpportunity = {
  dateKey: string;
  bookedSessionId: string;
  bookedCohortTitle: string;
  otherSessionId: string;
  otherCohortId: string;
  otherCohortTitle: string;
  otherSessionTitle: string;
  /** Which half the instructor is NOT yet booked for. */
  missingHalf: "day" | "evening";
};

export type InstructorScheduleView = {
  instructor: { id: string; name: string | null; email: string; scheduleToken: string | null };
  sessions: ScheduleSession[];
  fullDayOpportunities: FullDayOpportunity[];
  cohorts: { cohortId: string; title: string; status: string; participation: string }[];
};

type SessionRow = {
  id: string;
  title: string;
  date: Date;
  startTime: string;
  endTime: string;
  timezone: string;
  cohortId: string;
};

/**
 * Everything an instructor needs to see, keyed by their scheduleToken (the no-login
 * link) or their user id (admin views). Returns null when the token doesn't resolve.
 */
export async function getInstructorSchedule(
  by: { token: string } | { userId: string }
): Promise<InstructorScheduleView | null> {
  const instructor = await prisma.user.findFirst({
    where: "token" in by ? { scheduleToken: by.token } : { id: by.userId },
    select: { id: true, name: true, email: true, scheduleToken: true },
  });
  if (!instructor) return null;

  const records = await prisma.cohortInstructor.findMany({
    where: { instructorId: instructor.id, cohort: { status: { in: TRACKED_COHORT_STATUSES } } },
    select: {
      id: true,
      status: true,
      cohort: {
        select: {
          id: true,
          title: true,
          status: true,
          sessions: {
            orderBy: [{ date: "asc" }, { order: "asc" }],
            select: {
              id: true,
              title: true,
              date: true,
              startTime: true,
              endTime: true,
              timezone: true,
              cohortId: true,
            },
          },
        },
      },
      assignments: {
        select: {
          id: true,
          sessionId: true,
          status: true,
          note: true,
          adminNote: true,
          proposedDate: true,
          proposedStartTime: true,
          proposedEndTime: true,
        },
      },
    },
  });

  const sessions: ScheduleSession[] = [];
  for (const record of records) {
    const bySession = new Map(record.assignments.map((a) => [a.sessionId, a]));
    for (const session of record.cohort.sessions) {
      const assignment = bySession.get(session.id);
      const interval = sessionInterval(session);
      sessions.push({
        assignmentId: assignment?.id ?? null,
        sessionId: session.id,
        cohortId: record.cohort.id,
        cohortTitle: record.cohort.title,
        title: session.title,
        startUtc: interval?.startUtc.toISOString() ?? null,
        endUtc: interval?.endUtc.toISOString() ?? null,
        timezone: interval?.ianaTz ?? session.timezone,
        dateKey: interval ? localDateKey(interval.startUtc, interval.ianaTz) : null,
        status: (assignment?.status as AssignmentStatus) ?? "UNASSIGNED",
        note: assignment?.note ?? null,
        adminNote: assignment?.adminNote ?? null,
        proposedDate: assignment?.proposedDate?.toISOString() ?? null,
        proposedStartTime: assignment?.proposedStartTime ?? null,
        proposedEndTime: assignment?.proposedEndTime ?? null,
        conflictsWith: [],
        isEvening: interval ? localMinuteOfDay(interval.startUtc, interval.ianaTz) >= EVENING_START_MINUTE : false,
      });
    }
  }

  markConflicts(sessions);
  sessions.sort((a, b) => (a.startUtc ?? "").localeCompare(b.startUtc ?? ""));

  return {
    instructor,
    sessions,
    fullDayOpportunities: await findFullDayOpportunities(instructor.id, sessions),
    cohorts: records.map((r) => ({
      cohortId: r.cohort.id,
      title: r.cohort.title,
      status: r.cohort.status,
      participation: r.status,
    })),
  };
}

/**
 * Flag pairs of sessions this instructor is expected at that actually overlap in real
 * time. Declined sessions are excluded — turning one down is how a clash gets resolved.
 */
function markConflicts(sessions: ScheduleSession[]): void {
  const live = sessions.filter((s) => s.startUtc && s.status !== "DECLINED");
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const overlap = intervalsOverlap(
        { startUtc: new Date(a.startUtc!), endUtc: new Date(a.endUtc!) },
        { startUtc: new Date(b.startUtc!), endUtc: new Date(b.endUtc!) }
      );
      if (overlap) {
        a.conflictsWith.push(b.sessionId);
        b.conflictsWith.push(a.sessionId);
      }
    }
  }
}

/**
 * Day cohorts (10–5) and evening cohorts (6–9) run on the same dates, and the operator would
 * rather have one instructor for the whole day than two half-days. Find dates where
 * this instructor is already booked for one half and some *other* upcoming cohort has
 * an unbooked session in the other half.
 */
async function findFullDayOpportunities(
  instructorId: string,
  bookedSessions: ScheduleSession[]
): Promise<FullDayOpportunity[]> {
  const relevant = bookedSessions.filter((s) => s.dateKey && s.status !== "DECLINED");
  if (!relevant.length) return [];

  const bookedCohortIds = new Set(relevant.map((s) => s.cohortId));
  const candidates = await prisma.cohortSession.findMany({
    where: {
      cohort: { status: { in: TRACKED_COHORT_STATUSES }, id: { notIn: [...bookedCohortIds] } },
    },
    select: {
      id: true,
      title: true,
      date: true,
      startTime: true,
      endTime: true,
      timezone: true,
      cohortId: true,
      cohort: { select: { id: true, title: true } },
    },
  });

  const bookedByDate = new Map<string, ScheduleSession[]>();
  for (const s of relevant) {
    const list = bookedByDate.get(s.dateKey!) ?? [];
    list.push(s);
    bookedByDate.set(s.dateKey!, list);
  }

  const opportunities: FullDayOpportunity[] = [];
  for (const candidate of candidates) {
    const interval = sessionInterval(candidate as SessionRow);
    if (!interval) continue;
    const dateKey = localDateKey(interval.startUtc, interval.ianaTz);
    const sameDay = bookedByDate.get(dateKey);
    if (!sameDay?.length) continue;

    const candidateIsEvening = localMinuteOfDay(interval.startUtc, interval.ianaTz) >= EVENING_START_MINUTE;
    // Only a genuine complement counts: they're booked for the other half, and the two
    // don't actually collide.
    const complement = sameDay.find(
      (booked) =>
        booked.isEvening !== candidateIsEvening &&
        !intervalsOverlap(
          { startUtc: new Date(booked.startUtc!), endUtc: new Date(booked.endUtc!) },
          interval
        )
    );
    if (!complement) continue;

    opportunities.push({
      dateKey,
      bookedSessionId: complement.sessionId,
      bookedCohortTitle: complement.cohortTitle,
      otherSessionId: candidate.id,
      otherCohortId: candidate.cohort.id,
      otherCohortTitle: candidate.cohort.title,
      otherSessionTitle: candidate.title,
      missingHalf: candidateIsEvening ? "evening" : "day",
    });
  }
  return opportunities;
}

/**
 * Create PROPOSED assignments for a cohort.
 *
 * Real teaching rosters are sparse: an instructor or guest speaker usually covers
 * 1–2 sessions out of a 10–12 session cohort, not all of them. So `sessionIds`
 * scopes the proposal to the sessions that person actually teaches — proposing
 * the whole cohort to everyone would ask them to confirm days they were never
 * meant to cover.
 *
 * Omitting `sessionIds` still proposes every session (the whole-cohort case,
 * e.g. a single-instructor bootcamp).
 *
 * Idempotent: existing assignments (including answered ones) are left alone, so
 * re-running after adding a session is safe and never resets someone's answer.
 */
export async function proposeSchedule(
  cohortId: string,
  instructorIds?: string[],
  sessionIds?: string[]
): Promise<{ created: number; existing: number; unknownSessionIds: string[] }> {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: {
      sessions: { select: { id: true } },
      instructorRecords: {
        where: instructorIds?.length ? { instructorId: { in: instructorIds } } : undefined,
        select: { id: true },
      },
    },
  });
  if (!cohort) return { created: 0, existing: 0, unknownSessionIds: [] };

  // Session ids that don't belong to this cohort are reported rather than silently
  // dropped — a typo'd id would otherwise look like a successful no-op proposal.
  const cohortSessionIds = new Set(cohort.sessions.map((s) => s.id));
  const unknownSessionIds = (sessionIds ?? []).filter((id) => !cohortSessionIds.has(id));
  const targetSessions = sessionIds?.length
    ? cohort.sessions.filter((s) => sessionIds.includes(s.id))
    : cohort.sessions;

  let created = 0;
  let existing = 0;
  for (const record of cohort.instructorRecords) {
    for (const session of targetSessions) {
      const found = await prisma.sessionAssignment.findUnique({
        where: { cohortInstructorId_sessionId: { cohortInstructorId: record.id, sessionId: session.id } },
        select: { id: true },
      });
      if (found) {
        existing++;
        continue;
      }
      await prisma.sessionAssignment.create({
        data: { cohortInstructorId: record.id, sessionId: session.id },
      });
      created++;
    }
  }
  logger.info(
    { cohortId, created, existing, scopedToSessions: sessionIds?.length ?? "all", unknownSessionIds },
    "[instructorSchedule] proposed"
  );
  return { created, existing, unknownSessionIds };
}

/**
 * Remove a PROPOSED assignment — for fixing a mis-assignment before anyone has
 * answered. Deliberately refuses once the instructor has responded, so an
 * accidental un-assign can't erase a confirmation (clear it in the admin UI or
 * decline it properly instead).
 */
export async function unassignSession(
  cohortInstructorId: string,
  sessionId: string
): Promise<{ ok: boolean; error?: string }> {
  const assignment = await prisma.sessionAssignment.findUnique({
    where: { cohortInstructorId_sessionId: { cohortInstructorId, sessionId } },
    select: { id: true, status: true },
  });
  if (!assignment) return { ok: false, error: "No such assignment" };
  if (assignment.status !== "PROPOSED") {
    return { ok: false, error: `Already answered (${assignment.status}) — decline or clear it instead` };
  }
  await prisma.sessionAssignment.delete({ where: { id: assignment.id } });
  return { ok: true };
}

/** Instructor-side move on one session. Validated against the token by the caller. */
export async function respondToAssignment(
  assignmentId: string,
  action: "accept" | "request_change" | "decline",
  payload: { note?: string; proposedDate?: string; proposedStartTime?: string; proposedEndTime?: string } = {}
): Promise<{ ok: true; status: AssignmentStatus } | { ok: false; error: string }> {
  const assignment = await prisma.sessionAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, sessionId: true, status: true },
  });
  if (!assignment) return { ok: false, error: "Assignment not found" };

  const status: AssignmentStatus =
    action === "accept" ? "ACCEPTED" : action === "decline" ? "DECLINED" : "CHANGE_REQUESTED";

  await prisma.sessionAssignment.update({
    where: { id: assignmentId },
    data: {
      status,
      note: (payload.note ?? "").slice(0, 1000) || null,
      respondedAt: new Date(),
      // A counter-offer only records what they asked for; the real session moves
      // when an admin accepts the change.
      proposedDate: action === "request_change" && payload.proposedDate ? new Date(payload.proposedDate) : null,
      proposedStartTime: action === "request_change" ? payload.proposedStartTime ?? null : null,
      proposedEndTime: action === "request_change" ? payload.proposedEndTime ?? null : null,
      ...(action === "decline" ? { confirmedAt: null } : {}),
    },
  });

  // Declining after a confirmation must pull them off the calendar invite.
  if (action === "decline") await syncCohortSessionToGcal(assignment.sessionId);
  return { ok: true, status };
}

/** Admin confirms an accepted assignment — this is what puts it in Google Calendar. */
export async function confirmAssignment(assignmentId: string): Promise<{ ok: boolean; gcal?: string }> {
  const assignment = await prisma.sessionAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, sessionId: true, cohortInstructor: { select: { instructorId: true } } },
  });
  if (!assignment) return { ok: false };

  await prisma.sessionAssignment.update({
    where: { id: assignmentId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  // Name a lead instructor for the session if nobody holds it yet.
  await prisma.cohortSession.updateMany({
    where: { id: assignment.sessionId, instructorId: null },
    data: { instructorId: assignment.cohortInstructor.instructorId },
  });

  const result = await syncCohortSessionToGcal(assignment.sessionId);
  return { ok: true, gcal: result.outcome };
}

/** Admin counters a change request: keeps the session, sends the ask back. */
export async function counterAssignment(
  assignmentId: string,
  adminNote: string
): Promise<{ ok: boolean }> {
  await prisma.sessionAssignment.update({
    where: { id: assignmentId },
    data: { status: "PROPOSED", adminNote: adminNote.slice(0, 1000) || null },
  });
  return { ok: true };
}

/**
 * Admin accepts an instructor's counter-offer: move the real session to the requested
 * slot, confirm the assignment, and let Google Calendar ripple the change to everyone
 * else already invited. This is the only path that mutates a CohortSession's time.
 */
export async function acceptChangeRequest(assignmentId: string): Promise<{ ok: boolean; error?: string }> {
  const assignment = await prisma.sessionAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      sessionId: true,
      status: true,
      proposedDate: true,
      proposedStartTime: true,
      proposedEndTime: true,
    },
  });
  if (!assignment) return { ok: false, error: "Assignment not found" };
  if (assignment.status !== "CHANGE_REQUESTED") {
    return { ok: false, error: `Assignment is ${assignment.status}, not CHANGE_REQUESTED` };
  }

  const data: { date?: Date; startTime?: string; endTime?: string } = {};
  if (assignment.proposedDate) data.date = assignment.proposedDate;
  if (assignment.proposedStartTime) data.startTime = assignment.proposedStartTime;
  if (assignment.proposedEndTime) data.endTime = assignment.proposedEndTime;
  if (Object.keys(data).length) {
    await prisma.cohortSession.update({ where: { id: assignment.sessionId }, data });
  }

  await prisma.sessionAssignment.update({
    where: { id: assignmentId },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      proposedDate: null,
      proposedStartTime: null,
      proposedEndTime: null,
    },
  });

  await syncCohortSessionToGcal(assignment.sessionId);
  return { ok: true };
}

/** Everything waiting on an admin decision, across all tracked cohorts. */
export async function listChangeRequests() {
  const rows = await prisma.sessionAssignment.findMany({
    where: { status: "CHANGE_REQUESTED" },
    orderBy: { respondedAt: "desc" },
    select: {
      id: true,
      note: true,
      proposedDate: true,
      proposedStartTime: true,
      proposedEndTime: true,
      respondedAt: true,
      session: {
        select: {
          id: true,
          title: true,
          date: true,
          startTime: true,
          endTime: true,
          timezone: true,
          cohort: { select: { id: true, title: true } },
        },
      },
      cohortInstructor: { select: { instructor: { select: { name: true, email: true } } } },
    },
  });
  return rows.map((r) => ({
    assignmentId: r.id,
    instructor: r.cohortInstructor.instructor.name ?? r.cohortInstructor.instructor.email,
    email: r.cohortInstructor.instructor.email,
    cohortId: r.session.cohort.id,
    cohortTitle: r.session.cohort.title,
    sessionId: r.session.id,
    sessionTitle: r.session.title,
    currentDate: r.session.date.toISOString(),
    currentTime: `${r.session.startTime}–${r.session.endTime} ${r.session.timezone}`,
    proposedDate: r.proposedDate?.toISOString() ?? null,
    proposedTime:
      r.proposedStartTime && r.proposedEndTime ? `${r.proposedStartTime}–${r.proposedEndTime}` : null,
    note: r.note,
    respondedAt: r.respondedAt?.toISOString() ?? null,
  }));
}

/** Mint a schedule token on demand (instructors created after the v2 backfill). */
export async function ensureScheduleToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { scheduleToken: true } });
  if (user?.scheduleToken) return user.scheduleToken;
  const token = crypto.randomUUID();
  await prisma.user.update({ where: { id: userId }, data: { scheduleToken: token } });
  return token;
}
