// src/app/(dashboard)/admin/sessions/series/actions.ts
//
// Admin server actions for shared session series (the daily check-in call).
// All the real validation lives in src/lib/seriesAdmin.ts, which the
// /api/admin/session-series routes also call — this file is only the form seam.
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import {
  createSeries,
  setSeriesCohorts,
  updateOccurrence,
  updateSeries,
} from "@/lib/seriesAdmin";
import { toWallClock } from "@/lib/seriesSchedule";

async function requireManage() {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) throw new Error("Forbidden");
  return session!;
}

export async function createSeriesAction(formData: FormData) {
  await requireManage();

  await createSeries({
    title: formData.get("title"),
    kind: formData.get("kind"),
    description: formData.get("description"),
    // Checkbox group: one "days" entry per checked weekday.
    days: formData.getAll("days"),
    startTime: toWallClock(String(formData.get("startTime") ?? "")),
    endTime: toWallClock(String(formData.get("endTime") ?? "")),
    timezone: formData.get("timezone"),
    startDate: formData.get("startDate"),
    // Blank means rolling — no end date, re-provisioned a horizon at a time.
    endDate: formData.get("endDate") || null,
    instructorId: formData.get("instructorId"),
  });

  revalidatePath("/admin/sessions/series");
}

export async function updateSeriesAction(formData: FormData) {
  await requireManage();
  const id = String(formData.get("id"));

  await updateSeries(id, {
    title: formData.get("title"),
    kind: formData.get("kind"),
    status: formData.get("status"),
    description: formData.get("description"),
    days: formData.getAll("days"),
    startTime: toWallClock(String(formData.get("startTime") ?? "")),
    endTime: toWallClock(String(formData.get("endTime") ?? "")),
    timezone: formData.get("timezone"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate") || null,
    instructorId: formData.get("instructorId"),
  });

  revalidatePath(`/admin/sessions/series/${id}`);
  revalidatePath("/admin/sessions/series");
}

/**
 * Attach/detach cohorts. The form posts the FULL checked set, so an unchecked box
 * detaches — which is exactly how a cohort is handed to another instructor's series.
 */
export async function setSeriesCohortsAction(formData: FormData) {
  await requireManage();
  const id = String(formData.get("id"));

  await setSeriesCohorts(id, formData.getAll("cohortIds"));

  revalidatePath(`/admin/sessions/series/${id}`);
}

/** Per-occurrence instructor override — the day-to-day split without a second series. */
export async function assignOccurrenceAction(formData: FormData) {
  await requireManage();
  const seriesId = String(formData.get("seriesId"));
  const occurrenceId = String(formData.get("occurrenceId"));

  await updateOccurrence(seriesId, occurrenceId, {
    instructorId: formData.get("instructorId"),
  });

  revalidatePath(`/admin/sessions/series/${seriesId}`);
}
