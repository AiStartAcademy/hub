import { parseProjectTimeToMinutes } from "@/lib/calendarUtils";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import {
  createZoomMeeting,
  getMeetingDetails,
  sessionStatusAt,
  syncRecordingsToProgram,
  ZOOM_WEEKDAYS,
  type CreatedZoomMeeting,
  type CreateZoomMeetingInput,
  type ZoomMeeting,
  type ZoomWeekday,
} from "@/lib/zoom";

type SessionSeriesRow = {
  id: string;
  title: string;
  zoomLink: string | null;
  zoomMeetingId: string | null;
  days: string;
  startTime: string;
  endTime: string;
  timezone: string;
  startDate: Date;
  endDate: Date | null;
};

type SeriesOccurrenceWrite = {
  seriesId: string;
  title: string;
  date: Date;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  meetingLink: string | null;
  zoomOccurrenceId: string;
};

type SeriesOccurrenceUpdate = Omit<SeriesOccurrenceWrite, "seriesId" | "title" | "zoomOccurrenceId">;

export type SeriesSyncDeps = {
  db: {
    sessionSeries: {
      findUnique(args: { where: { id: string } }): Promise<SessionSeriesRow | null>;
    };
    seriesOccurrence: {
      deleteMany(args: {
        where: {
          seriesId: string;
          recordingLink: null;
          zoomOccurrenceId: { notIn: string[]; not: null };
        };
      }): Promise<{ count: number }>;
      upsert(args: {
        where: {
          seriesId_zoomOccurrenceId: {
            seriesId: string;
            zoomOccurrenceId: string;
          };
        };
        create: SeriesOccurrenceWrite;
        update: SeriesOccurrenceUpdate;
      }): Promise<unknown>;
    };
  };
  getMeetingDetails(meetingId: string): Promise<ZoomMeeting | null>;
};

export type SeriesProvisionDeps = {
  db: {
    sessionSeries: {
      findUnique(args: { where: { id: string } }): Promise<SessionSeriesRow | null>;
      update(args: {
        where: { id: string };
        data: { zoomLink: string; zoomMeetingId: string };
      }): Promise<unknown>;
    };
  };
  createZoomMeeting(input: CreateZoomMeetingInput): Promise<CreatedZoomMeeting>;
};

export type SeriesRecordingDeps = {
  db: {
    sessionSeries: {
      findUnique(args: { where: { zoomMeetingId: string } }): Promise<{ id: string } | null>;
    };
    seriesOccurrence: {
      findFirst(args: {
        where: { seriesId: string; date: { gte: Date; lte: Date } };
      }): Promise<{ id: string } | null>;
      update(args: {
        where: { id: string };
        data: { recordingLink: string };
      }): Promise<unknown>;
    };
    cohort: {
      findFirst(args: {
        where: { zoomLink: { contains: string } };
      }): Promise<{ id: string; rawProgramId: string | null } | null>;
    };
  };
  syncRecordingsToProgram(
    meetingId: string,
    cohortId: string,
    rawProgramId: string,
  ): Promise<void>;
};

const defaultSyncDeps: SeriesSyncDeps = {
  db: {
    sessionSeries: {
      findUnique: (args) => prisma.sessionSeries.findUnique(args),
    },
    seriesOccurrence: {
      deleteMany: (args) => prisma.seriesOccurrence.deleteMany(args),
      upsert: (args) => prisma.seriesOccurrence.upsert(args),
    },
  },
  getMeetingDetails,
};

const defaultProvisionDeps: SeriesProvisionDeps = {
  db: {
    sessionSeries: {
      findUnique: (args) => prisma.sessionSeries.findUnique(args),
      update: (args) => prisma.sessionSeries.update(args),
    },
  },
  createZoomMeeting,
};

const defaultRecordingDeps: SeriesRecordingDeps = {
  db: {
    sessionSeries: {
      findUnique: (args) => prisma.sessionSeries.findUnique(args),
    },
    seriesOccurrence: {
      findFirst: (args) => prisma.seriesOccurrence.findFirst(args),
      update: (args) => prisma.seriesOccurrence.update(args),
    },
    cohort: {
      findFirst: (args) => prisma.cohort.findFirst(args),
    },
  },
  syncRecordingsToProgram,
};

function assertValidMeeting(meeting: ZoomMeeting, seriesId: string): void {
  if (
    typeof meeting.id !== "number" ||
    !Number.isFinite(meeting.id) ||
    typeof meeting.timezone !== "string" ||
    typeof meeting.join_url !== "string" ||
    !Array.isArray(meeting.occurrences)
  ) {
    throw new Error(`[Session Series] Zoom returned invalid meeting details for series ${seriesId}`);
  }

  for (const occurrence of meeting.occurrences) {
    if (
      !occurrence ||
      typeof occurrence.occurrence_id !== "string" ||
      !occurrence.occurrence_id ||
      typeof occurrence.start_time !== "string" ||
      Number.isNaN(Date.parse(occurrence.start_time)) ||
      typeof occurrence.duration !== "number" ||
      !Number.isFinite(occurrence.duration) ||
      typeof occurrence.status !== "string"
    ) {
      throw new Error(`[Session Series] Zoom returned an invalid occurrence for series ${seriesId}`);
    }
  }
}

/** Pull one shared series' Zoom schedule into SeriesOccurrence rows. */
export async function syncSeriesOccurrences(
  seriesId: string,
  deps: SeriesSyncDeps = defaultSyncDeps,
): Promise<number | null> {
  const series = await deps.db.sessionSeries.findUnique({ where: { id: seriesId } });
  if (!series) {
    logger.info(`[Session Series] Series ${seriesId} was not found`);
    return null;
  }
  if (!series.zoomMeetingId) {
    logger.info(`[Session Series] Series ${seriesId} has no Zoom meeting ID`);
    return null;
  }

  const meeting = await deps.getMeetingDetails(series.zoomMeetingId);
  if (!meeting || !meeting.occurrences) {
    logger.info(`[Session Series] No occurrences found for series ${seriesId}`);
    return null;
  }
  assertValidMeeting(meeting, seriesId);

  const activeOccurrences = meeting.occurrences.filter((occurrence) => occurrence.status !== "deleted");
  logger.info(
    `[Session Series] Syncing ${activeOccurrences.length} active occurrences for series: ${series.title}`,
  );

  const zoomOccurrenceIds = activeOccurrences.map((occurrence) => occurrence.occurrence_id);
  await deps.db.seriesOccurrence.deleteMany({
    where: {
      seriesId,
      recordingLink: null,
      // Unlike the cohort sweep, a vanished recorded occurrence is the durable record
      // of that shared call. Authored non-Zoom rows are also preserved by the null guard.
      zoomOccurrenceId: { notIn: zoomOccurrenceIds, not: null },
    },
  });

  // Keep this mapping local: extracting the analogous cohort mapper would modify a
  // protected, mature sync path without reducing the series-specific differences.
  for (const [index, occurrence] of activeOccurrences.entries()) {
    const startDate = new Date(occurrence.start_time);
    const endDate = new Date(startDate.getTime() + (occurrence.duration || 60) * 60_000);
    const startTime = startDate.toISOString();
    const endTime = endDate.toISOString();
    const update: SeriesOccurrenceUpdate = {
      date: startDate,
      startTime,
      endTime,
      timezone: meeting.timezone || "UTC",
      status: sessionStatusAt(startDate, endDate),
      meetingLink: series.zoomLink,
    };

    await deps.db.seriesOccurrence.upsert({
      where: {
        seriesId_zoomOccurrenceId: {
          seriesId,
          zoomOccurrenceId: occurrence.occurrence_id,
        },
      },
      create: {
        seriesId,
        title: `Check-in ${index + 1}`,
        zoomOccurrenceId: occurrence.occurrence_id,
        ...update,
      },
      // Title is intentionally create-only so admin hand-edits survive later syncs.
      update,
    });
  }

  return activeOccurrences.length;
}

function parseSeriesDays(value: string, seriesId: string): ZoomWeekday[] {
  const days = value
    .split(",")
    .map((day) => day.trim().toUpperCase())
    .filter((day) => day.length > 0);

  if (
    days.length === 0 ||
    days.some((day) => !(ZOOM_WEEKDAYS as readonly string[]).includes(day))
  ) {
    throw new Error(`[Session Series] Series ${seriesId} has invalid Zoom weekdays: ${value}`);
  }
  return days as ZoomWeekday[];
}

function dateKeyUtc(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeKey(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hours}:${minute}:00`;
}

function assertCreatedMeeting(value: CreatedZoomMeeting, seriesId: string): void {
  if (
    typeof value.id !== "number" ||
    !Number.isFinite(value.id) ||
    typeof value.joinUrl !== "string" ||
    !value.joinUrl.trim() ||
    typeof value.startUrl !== "string" ||
    !value.startUrl.trim() ||
    (value.password !== null && typeof value.password !== "string")
  ) {
    throw new Error(`[Session Series] Zoom returned an invalid created meeting for series ${seriesId}`);
  }
}

/**
 * How far ahead a rolling series is provisioned in one go.
 *
 * Bounded by Zoom's hard cap of 60 occurrences (`end_times`), which
 * createZoomMeeting refuses to exceed. Ten weeks of a five-day-a-week check-in is
 * 50 occurrences — comfortably under, with room for a six-day week — and the job
 * that rolls cohorts forward re-extends the series before it runs out.
 */
export const DEFAULT_HORIZON_WEEKS = 10;

/**
 * Last calendar day (INCLUSIVE, as countOccurrences reads it) of a rolling horizon.
 *
 * The -1 day matters: `startDate + weeks*7` lands on the same weekday as the start,
 * so a 12-week Mon–Fri horizon computed that way yields 61 occurrences and Zoom
 * rejects the whole meeting. Ending the day before keeps "N weeks" meaning exactly
 * N×(days per week) sessions.
 */
export function seriesHorizonEnd(startDate: Date, horizonWeeks: number): Date {
  return new Date(startDate.getTime() + (horizonWeeks * 7 - 1) * 24 * 60 * 60 * 1_000);
}

/** Create the bounded Zoom recurrence for a shared series and persist its identifiers. */
export async function provisionSeriesZoom(
  seriesId: string,
  options: { horizonWeeks?: number } = {},
  deps: SeriesProvisionDeps = defaultProvisionDeps,
): Promise<CreatedZoomMeeting> {
  const series = await deps.db.sessionSeries.findUnique({ where: { id: seriesId } });
  if (!series) {
    throw new Error(`[Session Series] Cannot provision missing series ${seriesId}`);
  }

  const horizonWeeks = options.horizonWeeks ?? DEFAULT_HORIZON_WEEKS;
  if (!Number.isInteger(horizonWeeks) || horizonWeeks < 1) {
    throw new Error("[Session Series] horizonWeeks must be a positive integer");
  }

  const startMinutes = parseProjectTimeToMinutes(series.startTime);
  const endMinutes = parseProjectTimeToMinutes(series.endTime);
  if (endMinutes <= startMinutes) {
    throw new Error(`[Session Series] Series ${seriesId} endTime must be after startTime`);
  }

  const lastSessionDate = series.endDate
    ? new Date(series.endDate)
    : seriesHorizonEnd(series.startDate, horizonWeeks);
  const meeting = await deps.createZoomMeeting({
    topic: series.title,
    firstSessionStartLocal: `${dateKeyUtc(series.startDate)}T${timeKey(startMinutes)}`,
    durationMinutes: endMinutes - startMinutes,
    timezone: series.timezone,
    lastSessionDate,
    days: parseSeriesDays(series.days, seriesId),
  });
  assertCreatedMeeting(meeting, seriesId);

  await deps.db.sessionSeries.update({
    where: { id: seriesId },
    data: {
      zoomLink: meeting.joinUrl,
      zoomMeetingId: String(meeting.id),
    },
  });
  return meeting;
}

/** Route one Zoom recording event to a shared series before considering cohorts. */
export async function handleZoomRecordingCompleted(
  input: { meetingId: string; recordingStart: string; recordingLink: string },
  deps: SeriesRecordingDeps = defaultRecordingDeps,
): Promise<"series" | "cohort" | "ignored"> {
  // Malformed payloads are logged and acknowledged rather than thrown. Zoom retries
  // any non-2xx response, and a retry can never repair a permanently malformed event —
  // it just loops forever. Transient failures (a DB error below) still throw, because
  // for those a retry is exactly the right behaviour.
  if (!input.meetingId.trim()) {
    logger.error("[Session Series] Recording event is missing a meeting ID — ignoring");
    return "ignored";
  }

  const series = await deps.db.sessionSeries.findUnique({
    where: { zoomMeetingId: input.meetingId },
  });
  if (series) {
    const recordingDate = new Date(input.recordingStart);
    if (Number.isNaN(recordingDate.getTime())) {
      logger.error(
        `[Session Series] Recording event for series ${series.id} has an invalid recording start — ignoring`,
      );
      return "series";
    }
    if (!input.recordingLink.trim()) {
      logger.error(
        `[Session Series] Recording event for series ${series.id} has no recording link — ignoring`,
      );
      return "series";
    }

    const startOfDay = new Date(recordingDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(recordingDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const occurrence = await deps.db.seriesOccurrence.findFirst({
      where: { seriesId: series.id, date: { gte: startOfDay, lte: endOfDay } },
    });

    if (occurrence) {
      await deps.db.seriesOccurrence.update({
        where: { id: occurrence.id },
        data: { recordingLink: input.recordingLink },
      });
    } else {
      logger.warn(
        `[Session Series] No occurrence found for series ${series.id} on ${dateKeyUtc(recordingDate)}`,
      );
    }

    // A shared recording must never be imported into one cohort's raw program,
    // including when no same-day occurrence row was found.
    return "series";
  }

  const cohort = await deps.db.cohort.findFirst({
    where: { zoomLink: { contains: input.meetingId } },
  });
  if (cohort && cohort.rawProgramId) {
    logger.info(`[Zoom Webhook] Found recording for cohort: ${cohort.id}`);
    // Preserve the existing webhook behavior: import in the background so Zoom's
    // acknowledgement is not held open, but make every rejection visible in logs.
    deps.syncRecordingsToProgram(input.meetingId, cohort.id, cohort.rawProgramId).catch((error) => {
      logger.error({ err: error }, "[Zoom Webhook error]:");
    });
    return "cohort";
  }

  return "ignored";
}
