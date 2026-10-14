"use server";

// Admin server actions for the instructor-participation workflow:
// sync roster → draft outreach → approve → send → nudge stragglers.

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { revalidatePath } from "next/cache";
import { syncCohortInstructors } from "@/lib/instructorParticipation";
import { sendOutreach } from "@/lib/instructorOutreach";
import {
  proposeSchedule,
  unassignSession,
  acceptChangeRequest,
  counterAssignment,
  confirmAssignment,
  ensureScheduleToken,
} from "@/lib/instructorSchedule";
import { syncCohortSessionToGcal } from "@/lib/googleCalendar";

const PAGE = "/admin/cohorts/participation";

async function requireAdmin() {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, ["ADMIN", "TEAM_MEMBER"])) {
    throw new Error("Forbidden");
  }
  return session;
}

export async function syncAction(cohortId: string) {
  await requireAdmin();
  await syncCohortInstructors(cohortId);
  revalidatePath(PAGE);
  return { ok: true as const };
}

const DEFAULT_BODY = `<p>Hi {{first_name}},</p>
<p>You're on the teaching roster for <strong>{{cohort_title}}</strong> ({{cohort_dates}}). Before we lock the schedule, please confirm you're in and flag any sessions you can't make.</p>
{{sessions_html}}
<p>Takes about a minute — the button below opens your response page (no login needed).</p>`;

export async function draftOutreachAction(cohortId: string, subject?: string, body?: string) {
  const session = await requireAdmin();
  const outreach = await prisma.instructorOutreach.create({
    data: {
      cohortId,
      subject: subject?.trim() || "Please confirm: {{cohort_title}} teaching schedule",
      body: body?.trim() || DEFAULT_BODY,
      createdBy: (session.user as { id?: string }).id ?? "admin",
    },
  });
  revalidatePath(PAGE);
  return { ok: true as const, outreachId: outreach.id };
}

export async function approveOutreachAction(outreachId: string) {
  await requireAdmin();
  await prisma.instructorOutreach.update({
    where: { id: outreachId },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  revalidatePath(PAGE);
  return { ok: true as const };
}

export async function sendOutreachAction(outreachId: string, opts?: { only?: string[]; force?: boolean }) {
  await requireAdmin();
  const result = await sendOutreach(outreachId, opts ?? {});
  revalidatePath(PAGE);
  return { ok: true as const, result };
}

/** Re-send the latest sent/approved outreach to instructors still PENDING. */
export async function nudgeAction(cohortId: string) {
  await requireAdmin();
  const outreach = await prisma.instructorOutreach.findFirst({
    where: { cohortId, status: { in: ["APPROVED", "SENT"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!outreach) return { ok: false as const, error: "No approved outreach to nudge with" };
  const pending = await prisma.cohortInstructor.findMany({
    where: { cohortId, status: "PENDING" },
    select: { id: true },
  });
  if (!pending.length) return { ok: false as const, error: "Nobody is pending" };
  const result = await sendOutreach(outreach.id, { only: pending.map((p) => p.id) });
  revalidatePath(PAGE);
  return { ok: true as const, result };
}

// ── v2: schedule proposal, negotiation, calendar ──────────────────────

/**
 * Create PROPOSED assignments.
 *
 * With no instructorIds/sessionIds this proposes the whole cohort to everyone
 * (single-instructor case). Normally the picker passes one instructor and the
 * 1–2 sessions they actually teach.
 */
export async function proposeScheduleAction(
  cohortId: string,
  instructorIds?: string[],
  sessionIds?: string[]
) {
  await requireAdmin();
  const result = await proposeSchedule(cohortId, instructorIds, sessionIds);
  revalidatePath(PAGE);
  if (result.unknownSessionIds.length) {
    return { ok: false as const, error: `Sessions not in this cohort: ${result.unknownSessionIds.join(", ")}` };
  }
  return { ok: true as const, ...result };
}

/** Drop a mis-assigned session before the instructor has answered it. */
export async function unassignSessionAction(cohortInstructorId: string, sessionId: string) {
  await requireAdmin();
  const result = await unassignSession(cohortInstructorId, sessionId);
  revalidatePath(PAGE);
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error ?? "Failed" };
}

/** Accept an instructor's counter-offer: moves the session, then confirms + syncs. */
export async function acceptChangeAction(assignmentId: string) {
  await requireAdmin();
  const result = await acceptChangeRequest(assignmentId);
  revalidatePath(PAGE);
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error ?? "Failed" };
}

/** Send the ask back with a note, keeping the session where it is. */
export async function counterChangeAction(assignmentId: string, adminNote: string) {
  await requireAdmin();
  await counterAssignment(assignmentId, adminNote);
  revalidatePath(PAGE);
  return { ok: true as const };
}

/** Lock in an accepted assignment — this is what creates the calendar invite. */
export async function confirmAssignmentAction(assignmentId: string) {
  await requireAdmin();
  const result = await confirmAssignment(assignmentId);
  revalidatePath(PAGE);
  return result.ok ? { ok: true as const, gcal: result.gcal } : { ok: false as const, error: "Assignment not found" };
}

/** Re-push one session to Google Calendar after a failure or a manual edit. */
export async function resyncSessionGcalAction(sessionId: string) {
  await requireAdmin();
  const result = await syncCohortSessionToGcal(sessionId);
  revalidatePath(PAGE);
  return { ok: result.outcome !== "failed", outcome: result.outcome, error: result.error };
}

/**
 * Full-day pairing: bring an instructor onto the cohort covering the other half of a
 * day they're already teaching, and propose those sessions to them.
 */
export async function inviteForPairedCohortAction(cohortId: string, instructorId: string) {
  await requireAdmin();
  await prisma.cohort.update({
    where: { id: cohortId },
    data: { instructors: { connect: { id: instructorId } } },
  });
  await syncCohortInstructors(cohortId);
  await proposeSchedule(cohortId, [instructorId]);
  await ensureScheduleToken(instructorId);
  revalidatePath(PAGE);
  return { ok: true as const };
}

/** Copy-able schedule link for an instructor (mints the token if missing). */
export async function scheduleLinkAction(instructorId: string) {
  await requireAdmin();
  const token = await ensureScheduleToken(instructorId);
  return { ok: true as const, token };
}
