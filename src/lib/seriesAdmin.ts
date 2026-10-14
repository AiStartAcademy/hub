// Write side of SessionSeries administration.
//
// Both the admin UI (server actions) and the /api/admin/session-series routes call these,
// so validation lives in exactly one place. Zoom provisioning is deliberately NOT part of
// create/update — see provisionSeriesZoom in src/lib/sessionSeries.ts and the note on
// updateSeries below.

import prisma from "@/lib/prisma";
import {
  normalizeSeriesDays,
  SeriesInputError,
  SERIES_KINDS,
  SERIES_STATUSES,
} from "@/lib/seriesSchedule";

export { SeriesInputError };

function requireTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) throw new SeriesInputError("Title is required");
  return title;
}

function parseDate(value: unknown, field: string): Date {
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) throw new SeriesInputError(`${field} must be a valid date`);
  return d;
}

export type SeriesInput = {
  title: unknown;
  kind?: unknown;
  status?: unknown;
  description?: unknown;
  days: unknown;
  startTime: unknown;
  endTime: unknown;
  timezone?: unknown;
  startDate: unknown;
  endDate?: unknown;
  instructorId?: unknown;
};

export async function createSeries(input: SeriesInput) {
  const title = requireTitle(input.title);
  const days = normalizeSeriesDays(input.days).join(",");

  if (typeof input.startTime !== "string" || !input.startTime) {
    throw new SeriesInputError("startTime is required");
  }
  if (typeof input.endTime !== "string" || !input.endTime) {
    throw new SeriesInputError("endTime is required");
  }

  const kind = SERIES_KINDS.includes(input.kind as never) ? (input.kind as string) : "CHECKIN";
  const status = SERIES_STATUSES.includes(input.status as never) ? (input.status as string) : "ACTIVE";

  return prisma.sessionSeries.create({
    data: {
      title,
      kind,
      status,
      description: typeof input.description === "string" ? input.description.trim() || null : null,
      days,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: typeof input.timezone === "string" && input.timezone ? input.timezone : "America/Los_Angeles",
      startDate: parseDate(input.startDate, "startDate"),
      // null endDate = rolling; the Zoom series is provisioned a horizon at a time.
      endDate: input.endDate ? parseDate(input.endDate, "endDate") : null,
      instructorId: typeof input.instructorId === "string" && input.instructorId ? input.instructorId : null,
    },
  });
}

/**
 * Partial update. Schedule fields stay editable, but changing them does NOT reshape an
 * already-provisioned Zoom meeting — re-provision explicitly afterwards. The cohort MCP
 * PATCH refuses zoomLink for the same reason: letting the DB and Zoom drift apart
 * silently is worse than making the second step deliberate.
 */
export async function updateSeries(id: string, patch: Partial<SeriesInput>) {
  const data: Record<string, unknown> = {};

  if (patch.title !== undefined) data.title = requireTitle(patch.title);
  if (typeof patch.description === "string") data.description = patch.description.trim() || null;
  if (patch.kind !== undefined) {
    if (!SERIES_KINDS.includes(patch.kind as never)) throw new SeriesInputError("Invalid kind");
    data.kind = patch.kind;
  }
  if (patch.status !== undefined) {
    if (!SERIES_STATUSES.includes(patch.status as never)) throw new SeriesInputError("Invalid status");
    data.status = patch.status;
  }
  if (patch.days !== undefined) data.days = normalizeSeriesDays(patch.days).join(",");
  if (typeof patch.startTime === "string" && patch.startTime) data.startTime = patch.startTime;
  if (typeof patch.endTime === "string" && patch.endTime) data.endTime = patch.endTime;
  if (typeof patch.timezone === "string" && patch.timezone) data.timezone = patch.timezone;
  if (patch.startDate !== undefined) data.startDate = parseDate(patch.startDate, "startDate");
  if (patch.endDate !== undefined) {
    data.endDate = patch.endDate === null || patch.endDate === "" ? null : parseDate(patch.endDate, "endDate");
  }
  if (patch.instructorId !== undefined) data.instructorId = patch.instructorId || null;

  if (Object.keys(data).length === 0) throw new SeriesInputError("Nothing to update");

  return prisma.sessionSeries.update({ where: { id }, data });
}

/**
 * Set the FULL list of cohorts this series serves — not a delta.
 *
 * This is the core control of the feature: attaching is how one check-in covers every
 * running day cohort; detaching is how a cohort is handed to a second instructor (it is
 * attached to that instructor's series instead). As a set operation both directions are
 * one idempotent call.
 */
export async function setSeriesCohorts(seriesId: string, rawCohortIds: unknown[]) {
  const cohortIds = [...new Set<string>(rawCohortIds.map((c) => String(c)))];

  const series = await prisma.sessionSeries.findUnique({ where: { id: seriesId }, select: { id: true } });
  if (!series) throw new SeriesInputError("Series not found");

  // Reject unknown ids outright rather than attaching a subset — a half-applied
  // attachment is the kind of thing nobody notices until a student misses a call.
  if (cohortIds.length) {
    const found = await prisma.cohort.findMany({ where: { id: { in: cohortIds } }, select: { id: true } });
    if (found.length !== cohortIds.length) {
      const missing = cohortIds.filter((c) => !found.some((f) => f.id === c));
      throw new SeriesInputError(`Unknown cohort ids: ${missing.join(", ")}`);
    }
  }

  await prisma.$transaction([
    prisma.sessionSeriesCohort.deleteMany({ where: { seriesId, cohortId: { notIn: cohortIds } } }),
    ...cohortIds.map((cohortId) =>
      prisma.sessionSeriesCohort.upsert({
        where: { seriesId_cohortId: { seriesId, cohortId } },
        create: { seriesId, cohortId },
        update: {},
      })
    ),
  ]);

  const links = await prisma.sessionSeriesCohort.findMany({
    where: { seriesId },
    include: { cohort: { select: { id: true, title: true, status: true } } },
  });
  return links.map((l) => l.cohort);
}

/**
 * Per-occurrence edits: title, recordingLink, instructor override.
 *
 * The instructor override is the day-to-day split mechanism ("Sergei takes Thursday")
 * without creating a second series. Date/time/status come from Zoom on every sync and
 * are deliberately not accepted, matching the cohort session PATCH.
 */
export async function updateOccurrence(
  seriesId: string,
  occurrenceId: string,
  patch: { title?: unknown; recordingLink?: unknown; instructorId?: unknown }
) {
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = requireTitle(patch.title);
  if (typeof patch.recordingLink === "string") data.recordingLink = patch.recordingLink.trim() || null;
  if (patch.instructorId !== undefined) data.instructorId = patch.instructorId || null;

  if (Object.keys(data).length === 0) throw new SeriesInputError("Nothing to update");

  // seriesId in the where clause keeps one series from editing another's rows.
  const result = await prisma.seriesOccurrence.updateMany({ where: { id: occurrenceId, seriesId }, data });
  if (result.count === 0) throw new SeriesInputError("Occurrence not found");

  return prisma.seriesOccurrence.findUnique({ where: { id: occurrenceId } });
}
