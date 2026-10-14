// Read side of the shared session series — see prisma/schema.prisma ("Shared Session Series")
// and src/lib/sessionSeries.ts for the write side.
//
// A SeriesOccurrence is not a CohortSession, so every schedule surface has to merge two
// streams. Rather than teach each page how to do that, both are normalized into one
// ScheduleEntry here and merged once.

import prisma from "@/lib/prisma";

/**
 * A caller-supplied value was invalid — the API routes map this to a 400.
 *
 * Lives here rather than in seriesAdmin.ts so the pure parsers below can throw it
 * without importing the Prisma-backed module. Matching on the error TYPE is the
 * point: an earlier version matched `message.includes("weekday")`, which would
 * have turned an unrelated internal error into a 400 if its text happened to
 * mention one.
 */
export class SeriesInputError extends Error {}

export const SERIES_KINDS = ["CHECKIN", "ONBOARDING"] as const;
export const SERIES_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

/** Zoom's weekday vocabulary, same order/spelling cohort_create's `zoomDays` uses. */
export const SERIES_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type SeriesWeekday = (typeof SERIES_WEEKDAYS)[number];

/**
 * Parses the stored CSV (or an array from a request body) into canonical weekday codes,
 * deduped and in week order so "THU,MON" and "MON,THU" are the same schedule.
 *
 * Throws rather than defaulting to a "usual" week: cohort formats genuinely differ
 * (Mon–Thu vs Mon–Fri) and guessing here has already produced one wrong Zoom recurrence.
 */
export function normalizeSeriesDays(input: unknown): SeriesWeekday[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const seen = new Set<SeriesWeekday>();
  // "".split(",") is [""], not [] — drop blanks first so an empty input reports
  // "days is required" rather than an unrecognised-weekday error for "".
  for (const item of raw.map((i) => String(i).trim()).filter(Boolean)) {
    const code = item.toUpperCase().slice(0, 3) as SeriesWeekday;
    if (!SERIES_WEEKDAYS.includes(code)) {
      throw new SeriesInputError(
        `Unrecognised weekday "${item}" — expected one of ${SERIES_WEEKDAYS.join(", ")}`
      );
    }
    seen.add(code);
  }
  if (seen.size === 0) {
    throw new SeriesInputError('days is required, e.g. "MON,TUE,WED,THU,FRI"');
  }

  return SERIES_WEEKDAYS.filter((d) => seen.has(d));
}

export type ScheduleEntry = {
  id: string;
  /** Which table this came from — the UI labels shared check-ins differently. */
  kind: "cohort" | "series";
  title: string;
  /** Cohort title for a cohort session; the series title for a shared one. */
  context: string;
  date: Date;
  /** UTC ISO string, same convention as CohortSession.startTime. */
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  meetingLink: string | null;
  recordingLink: string | null;
  instructorId: string | null;
};

export type ScheduleViewer = {
  userId: string;
  role: string;
};

/**
 * "18:00" (an <input type="time"> value) → "6:00 PM", the wall-clock form that Cohort
 * and SessionSeries store and that Zoom's meeting create expects.
 *
 * Midnight and noon are the whole reason this is a tested function rather than inline
 * arithmetic: hour 0 is 12 AM and hour 12 is 12 PM, both of which `h % 12` gets wrong
 * without the explicit guard.
 */
export function toWallClock(value: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return value;
  const h = Number(m[1]);
  if (h < 0 || h > 23) return value;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m[2]} ${suffix}`;
}

/** "6:00 PM" → "18:00", for round-tripping back into <input type="time">. */
export function toInputTime(wall: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(wall.trim());
  if (!m) return wall;
  let h = Number(m[1]);
  const suffix = m[3]?.toUpperCase();
  if (suffix === "PM" && h !== 12) h += 12;
  if (suffix === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * The SessionSeries `where` clause a given viewer may read. Pure and exported so the
 * visibility rules are testable without a database — they are the security boundary
 * between one cohort's students and another's.
 */
export function seriesVisibilityFilter(viewer: ScheduleViewer): Record<string, unknown> {
  const filter: Record<string, unknown> = { status: "ACTIVE" };

  if (viewer.role === "STUDENT") {
    filter.cohorts = {
      some: { cohort: { enrollments: { some: { userId: viewer.userId, status: "active" } } } },
    };
  } else if (viewer.role === "INSTRUCTOR") {
    filter.OR = [
      { instructorId: viewer.userId },
      { occurrences: { some: { instructorId: viewer.userId } } },
      { cohorts: { some: { cohort: { instructors: { some: { id: viewer.userId } } } } } },
    ];
  }
  // ADMIN / TEAM_MEMBER fall through with only the ACTIVE constraint.

  return filter;
}

/**
 * Upcoming occurrences of every series the viewer can see, from `from` onward.
 *
 * Visibility mirrors the cohort-session rules on the dashboard:
 *   STUDENT    — series attached to a cohort they are actively enrolled in
 *   INSTRUCTOR — series they lead, plus occurrences individually assigned to them,
 *                plus series attached to cohorts they teach
 *   ADMIN / TEAM_MEMBER — everything on an ACTIVE series
 *
 * A PAUSED or ARCHIVED series is never shown to students; the check-in has stopped
 * running even though its future Zoom occurrences still exist.
 */
export async function getVisibleSeriesOccurrences(
  viewer: ScheduleViewer,
  opts: { from?: Date; take?: number } = {}
): Promise<ScheduleEntry[]> {
  const from = opts.from ?? new Date();
  const seriesFilter = seriesVisibilityFilter(viewer);

  const rows = await prisma.seriesOccurrence.findMany({
    where: { date: { gte: from }, series: seriesFilter },
    orderBy: { date: "asc" },
    take: opts.take ?? 10,
    include: { series: { select: { title: true, instructorId: true } } },
  });

  return rows.map((o) => ({
    id: o.id,
    kind: "series" as const,
    title: o.title,
    context: o.series.title,
    date: o.date,
    startTime: o.startTime,
    endTime: o.endTime,
    timezone: o.timezone,
    status: o.status,
    meetingLink: o.meetingLink,
    recordingLink: o.recordingLink,
    // A per-occurrence instructor overrides the series lead — this is how a cohort
    // gets handed to a second instructor without moving any other cohort.
    instructorId: o.instructorId ?? o.series.instructorId,
  }));
}

/** Every series occurrence attached to one cohort, for that cohort's schedule panel. */
export async function getCohortSeriesOccurrences(
  cohortId: string,
  opts: { from?: Date; take?: number } = {}
): Promise<ScheduleEntry[]> {
  const rows = await prisma.seriesOccurrence.findMany({
    where: {
      ...(opts.from ? { date: { gte: opts.from } } : {}),
      series: { status: "ACTIVE", cohorts: { some: { cohortId } } },
    },
    orderBy: { date: "asc" },
    ...(opts.take ? { take: opts.take } : {}),
    include: { series: { select: { title: true, instructorId: true } } },
  });

  return rows.map((o) => ({
    id: o.id,
    kind: "series" as const,
    title: o.title,
    context: o.series.title,
    date: o.date,
    startTime: o.startTime,
    endTime: o.endTime,
    timezone: o.timezone,
    status: o.status,
    meetingLink: o.meetingLink,
    recordingLink: o.recordingLink,
    instructorId: o.instructorId ?? o.series.instructorId,
  }));
}

/** Merge two already-sorted-ish streams into one chronological list. */
export function mergeSchedule(a: ScheduleEntry[], b: ScheduleEntry[], take?: number): ScheduleEntry[] {
  const merged = [...a, ...b].sort((x, y) => {
    const xs = Date.parse(x.startTime);
    const ys = Date.parse(y.startTime);
    // startTime is UTC ISO for Zoom-derived rows, but authored rows may predate that
    // convention — fall back to `date` rather than sorting NaNs.
    const xv = Number.isNaN(xs) ? x.date.getTime() : xs;
    const yv = Number.isNaN(ys) ? y.date.getTime() : ys;
    return xv - yv;
  });
  return take ? merged.slice(0, take) : merged;
}
