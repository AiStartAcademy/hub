// src/lib/instructorParticipation.ts
// Keeps the explicit CohortInstructor participation records in sync with the
// implicit "CohortInstructors" m2m, which remains the read source for public
// pages. Call syncCohortInstructors() after ANY mutation of cohort.instructors
// (admin instructor add/remove, MCP cohorts PATCH `instructorEmails`, cohort create).

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type ParticipationStatus = "PENDING" | "CONFIRMED" | "DECLINED";

/**
 * Upsert CohortInstructor rows for every currently-assigned instructor and
 * clean up rows for unassigned ones. Removal rule: a record is deleted only if
 * it is still PENDING and has never been emailed (no sends, no invitedAt) —
 * otherwise it is kept as history so a CONFIRMED/DECLINED answer isn't lost
 * when someone is temporarily unassigned.
 */
export async function syncCohortInstructors(cohortId: string): Promise<void> {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: { id: true, instructors: { select: { id: true } } },
  });
  if (!cohort) return;

  const assignedIds = new Set(cohort.instructors.map((i) => i.id));

  const existing = await prisma.cohortInstructor.findMany({
    where: { cohortId },
    select: { id: true, instructorId: true, status: true, invitedAt: true, _count: { select: { outreachSends: true } } },
  });
  const existingByInstructor = new Map(existing.map((r) => [r.instructorId, r]));

  for (const instructorId of assignedIds) {
    if (!existingByInstructor.has(instructorId)) {
      await prisma.cohortInstructor.create({ data: { cohortId, instructorId } });
    }
  }

  const removable = existing.filter(
    (r) =>
      !assignedIds.has(r.instructorId) &&
      r.status === "PENDING" &&
      !r.invitedAt &&
      r._count.outreachSends === 0
  );
  if (removable.length) {
    await prisma.cohortInstructor.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } });
  }

  logger.info(
    { cohortId, assigned: assignedIds.size, removed: removable.length },
    "[instructorParticipation] synced"
  );
}

/** Cohort statuses considered "published/upcoming" for participation tracking. */
export const TRACKED_COHORT_STATUSES = ["ENROLLMENT", "IN_PROGRESS"];

/**
 * Participation rollup for admin/MCP surfaces: cohorts × instructors × status
 * × per-session availability.
 */
export async function getParticipationStatus(cohortId?: string) {
  const cohorts = await prisma.cohort.findMany({
    where: cohortId ? { id: cohortId } : { status: { in: TRACKED_COHORT_STATUSES } },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      startDate: true,
      endDate: true,
      instructorRecords: {
        select: {
          id: true,
          status: true,
          invitedAt: true,
          respondedAt: true,
          notes: true,
          responseToken: true,
          instructor: { select: { id: true, name: true, email: true } },
          sessionResponses: {
            select: {
              availability: true,
              note: true,
              session: { select: { id: true, title: true, date: true, startTime: true, endTime: true } },
            },
          },
          // Which sessions this person is actually assigned to teach — drives the
          // picker's checked state and the "N of M sessions" summary.
          assignments: {
            select: { id: true, status: true, sessionId: true },
          },
        },
      },
      // Full session rows (not just a count) so the admin session picker can
      // offer "which sessions does this person teach" without a second query.
      sessions: {
        select: { id: true, title: true, date: true, startTime: true, endTime: true, timezone: true },
        orderBy: [{ date: "asc" }, { order: "asc" }],
      },
    },
  });

  return cohorts.map((c) => ({
    cohortId: c.id,
    title: c.title,
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate,
    sessionCount: c.sessions.length,
    sessions: c.sessions,
    instructors: c.instructorRecords.map((r) => ({
      cohortInstructorId: r.id,
      instructorId: r.instructor.id,
      name: r.instructor.name,
      email: r.instructor.email,
      status: r.status,
      invitedAt: r.invitedAt,
      respondedAt: r.respondedAt,
      notes: r.notes,
      responseToken: r.responseToken,
      assignedSessionIds: r.assignments.map((a) => a.sessionId),
      // Only PROPOSED assignments can be un-assigned; answered ones are history.
      unansweredSessionIds: r.assignments.filter((a) => a.status === "PROPOSED").map((a) => a.sessionId),
      sessionResponses: r.sessionResponses.map((s) => ({
        sessionId: s.session.id,
        title: s.session.title,
        date: s.session.date,
        availability: s.availability,
        note: s.note,
      })),
    })),
    unconfirmedCount: c.instructorRecords.filter((r) => r.status !== "CONFIRMED").length,
  }));
}
