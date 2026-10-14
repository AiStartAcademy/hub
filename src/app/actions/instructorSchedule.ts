"use server";

// Server actions behind the tokenized instructor schedule page.
//
// The scheduleToken is the only auth, so every action re-resolves it and checks that
// the assignment being touched actually belongs to that instructor — a valid token
// must never be usable to answer on someone else's behalf.

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { respondToAssignment } from "@/lib/instructorSchedule";

async function assignmentBelongsToToken(assignmentId: string, token: string): Promise<boolean> {
  const assignment = await prisma.sessionAssignment.findUnique({
    where: { id: assignmentId },
    select: { cohortInstructor: { select: { instructor: { select: { scheduleToken: true } } } } },
  });
  return Boolean(token) && assignment?.cohortInstructor.instructor.scheduleToken === token;
}

export type ScheduleActionInput = {
  token: string;
  assignmentId: string;
  action: "accept" | "request_change" | "decline";
  note?: string;
  proposedDate?: string;
  proposedStartTime?: string;
  proposedEndTime?: string;
};

export async function submitScheduleResponse(input: ScheduleActionInput) {
  if (!(await assignmentBelongsToToken(input.assignmentId, input.token))) {
    return { ok: false as const, error: "Invalid link" };
  }
  const result = await respondToAssignment(input.assignmentId, input.action, {
    note: input.note,
    proposedDate: input.proposedDate,
    proposedStartTime: input.proposedStartTime,
    proposedEndTime: input.proposedEndTime,
  });
  revalidatePath(`/instructor-schedule/${input.token}`);
  return result.ok ? { ok: true as const, status: result.status } : { ok: false as const, error: result.error };
}

/** Accept every still-open session in one cohort — the "I'm in for all of it" button. */
export async function acceptAllForCohort(token: string, cohortId: string) {
  const instructor = await prisma.user.findFirst({
    where: { scheduleToken: token },
    select: { id: true },
  });
  if (!instructor) return { ok: false as const, error: "Invalid link" };

  const record = await prisma.cohortInstructor.findUnique({
    where: { cohortId_instructorId: { cohortId, instructorId: instructor.id } },
    select: { id: true },
  });
  if (!record) return { ok: false as const, error: "Not assigned to this cohort" };

  const open = await prisma.sessionAssignment.findMany({
    where: { cohortInstructorId: record.id, status: { in: ["PROPOSED", "COUNTERED"] } },
    select: { id: true },
  });
  for (const assignment of open) {
    await respondToAssignment(assignment.id, "accept");
  }
  // Accepting the sessions is also answering the cohort-level question from v1.
  await prisma.cohortInstructor.update({
    where: { id: record.id },
    data: { status: "CONFIRMED", respondedAt: new Date() },
  });

  revalidatePath(`/instructor-schedule/${token}`);
  return { ok: true as const, accepted: open.length };
}
