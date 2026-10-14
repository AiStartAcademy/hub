import { describe, expect, it } from "bun:test";
import {
  DEFAULT_HORIZON_WEEKS,
  handleZoomRecordingCompleted,
  provisionSeriesZoom,
  seriesHorizonEnd,
  syncSeriesOccurrences,
  type SeriesProvisionDeps,
  type SeriesRecordingDeps,
  type SeriesSyncDeps,
} from "@/lib/sessionSeries";
import { countOccurrences } from "@/lib/zoom";
import type {
  CreateZoomMeetingInput,
  CreatedZoomMeeting,
  ZoomMeeting,
} from "@/lib/zoom";

// Shared-session-series decisions live behind injected database and Zoom boundaries so
// these tests do not need mock.module, whose process-wide state leaks across test files.

const syncSeriesOccurrencesContract: (
  seriesId: string,
  deps?: SeriesSyncDeps,
) => Promise<number | null> = syncSeriesOccurrences;

const provisionSeriesZoomContract: (
  seriesId: string,
  options?: { horizonWeeks?: number },
  deps?: SeriesProvisionDeps,
) => Promise<CreatedZoomMeeting> = provisionSeriesZoom;

const handleZoomRecordingCompletedContract: (
  input: {
    meetingId: string;
    recordingStart: string;
    recordingLink: string;
  },
  deps?: SeriesRecordingDeps,
) => Promise<"series" | "cohort" | "ignored"> = handleZoomRecordingCompleted;

type SeriesRow = {
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

type OccurrenceRow = {
  id: string;
  seriesId: string;
  title: string;
  date: Date;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  meetingLink: string | null;
  recordingLink: string | null;
  zoomOccurrenceId: string | null;
};

type SyncHarness = {
  deps: SeriesSyncDeps;
  occurrences: OccurrenceRow[];
  upserts: Array<Record<string, unknown>>;
  deletes: Array<Record<string, unknown>>;
};

function series(overrides: Partial<SeriesRow> = {}): SeriesRow {
  return {
    id: "series-1",
    title: "Daily Check-in",
    zoomLink: "https://zoom.us/j/900100200",
    zoomMeetingId: "900100200",
    days: "MON,TUE,WED,THU,FRI",
    startTime: "11:00 AM",
    endTime: "11:30 AM",
    timezone: "America/Los_Angeles",
    startDate: new Date("2026-10-05T00:00:00.000Z"),
    endDate: null,
    ...overrides,
  };
}

function zoomMeeting(
  occurrences: NonNullable<ZoomMeeting["occurrences"]>,
  overrides: Partial<ZoomMeeting> = {},
): ZoomMeeting {
  return {
    id: 900100200,
    topic: "Daily Check-in",
    type: 8,
    timezone: "America/Los_Angeles",
    join_url: "https://zoom.us/j/900100200",
    occurrences,
    ...overrides,
  };
}

function syncHarness(opts: {
  series: SeriesRow[];
  meetings: Record<string, ZoomMeeting | null>;
  occurrences?: OccurrenceRow[];
}): SyncHarness {
  const occurrences = [...(opts.occurrences ?? [])];
  const upserts: Array<Record<string, unknown>> = [];
  const deletes: Array<Record<string, unknown>> = [];

  const deps = {
    db: {
      sessionSeries: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          opts.series.find((row) => row.id === where.id) ?? null,
      },
      seriesOccurrence: {
        deleteMany: async ({ where }: {
          where: {
            seriesId: string;
            recordingLink: null;
            zoomOccurrenceId: { notIn: string[]; not: null };
          };
        }) => {
          deletes.push(where);
          let count = 0;
          for (let index = occurrences.length - 1; index >= 0; index -= 1) {
            const row = occurrences[index];
            if (
              row.seriesId === where.seriesId &&
              row.recordingLink === null &&
              row.zoomOccurrenceId !== null &&
              !where.zoomOccurrenceId.notIn.includes(row.zoomOccurrenceId)
            ) {
              occurrences.splice(index, 1);
              count += 1;
            }
          }
          return { count };
        },
        upsert: async (args: {
          where: {
            seriesId_zoomOccurrenceId: {
              seriesId: string;
              zoomOccurrenceId: string;
            };
          };
          create: Omit<OccurrenceRow, "id" | "recordingLink">;
          update: Partial<OccurrenceRow>;
        }) => {
          upserts.push(args);
          const key = args.where.seriesId_zoomOccurrenceId;
          const existing = occurrences.find(
            (row) =>
              row.seriesId === key.seriesId &&
              row.zoomOccurrenceId === key.zoomOccurrenceId,
          );
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          const created: OccurrenceRow = {
            id: `occurrence-${occurrences.length + 1}`,
            recordingLink: null,
            ...args.create,
          };
          occurrences.push(created);
          return created;
        },
      },
    },
    getMeetingDetails: async (meetingId: string) => opts.meetings[meetingId] ?? null,
  } satisfies SeriesSyncDeps;

  return { deps, occurrences, upserts, deletes };
}

describe("shared session series", () => {
  it("SC-a: syncSeriesOccurrences upserts one SeriesOccurrence per active Zoom occurrence, keyed on [seriesId, zoomOccurrenceId]", async () => {
    const meeting = zoomMeeting([
      {
        occurrence_id: "1791219600000",
        start_time: "2026-10-05T18:00:00.000Z",
        duration: 30,
        status: "available",
      },
      {
        occurrence_id: "1791306000000",
        start_time: "2026-10-06T18:00:00.000Z",
        duration: 45,
        status: "available",
      },
    ]);
    const harness = syncHarness({
      series: [series()],
      meetings: { "900100200": meeting },
    });

    const count = await syncSeriesOccurrencesContract("series-1", harness.deps);

    expect(count).toBe(2);
    expect(harness.upserts).toHaveLength(2);
    expect(harness.upserts.map((call) => call.where)).toEqual([
      {
        seriesId_zoomOccurrenceId: {
          seriesId: "series-1",
          zoomOccurrenceId: "1791219600000",
        },
      },
      {
        seriesId_zoomOccurrenceId: {
          seriesId: "series-1",
          zoomOccurrenceId: "1791306000000",
        },
      },
    ]);
    expect(harness.occurrences.map((row) => ({
      title: row.title,
      startTime: row.startTime,
      endTime: row.endTime,
      timezone: row.timezone,
      meetingLink: row.meetingLink,
    }))).toEqual([
      {
        title: "Check-in 1",
        startTime: "2026-10-05T18:00:00.000Z",
        endTime: "2026-10-05T18:30:00.000Z",
        timezone: "America/Los_Angeles",
        meetingLink: "https://zoom.us/j/900100200",
      },
      {
        title: "Check-in 2",
        startTime: "2026-10-06T18:00:00.000Z",
        endTime: "2026-10-06T18:45:00.000Z",
        timezone: "America/Los_Angeles",
        meetingLink: "https://zoom.us/j/900100200",
      },
    ]);
    for (const call of harness.upserts) {
      expect(call.update).not.toHaveProperty("title");
    }
  });

  it("SC-b: syncSeriesOccurrences preserves a vanished recorded occurrence and deletes a vanished unrecorded occurrence", async () => {
    const recorded = {
      id: "recorded",
      seriesId: "series-1",
      title: "Hand-edited recorded check-in",
      date: new Date("2026-10-01T18:00:00.000Z"),
      startTime: "2026-10-01T18:00:00.000Z",
      endTime: "2026-10-01T18:30:00.000Z",
      timezone: "America/Los_Angeles",
      status: "completed",
      meetingLink: "https://zoom.us/j/900100200",
      recordingLink: "https://zoom.us/rec/share/kept",
      zoomOccurrenceId: "vanished-recorded",
    } satisfies OccurrenceRow;
    const unrecorded = {
      ...recorded,
      id: "unrecorded",
      title: "Vanished without recording",
      recordingLink: null,
      zoomOccurrenceId: "vanished-unrecorded",
    } satisfies OccurrenceRow;
    const authored = {
      ...recorded,
      id: "authored",
      title: "Authored outside Zoom",
      recordingLink: null,
      zoomOccurrenceId: null,
    } satisfies OccurrenceRow;
    const harness = syncHarness({
      series: [series()],
      meetings: { "900100200": zoomMeeting([]) },
      occurrences: [recorded, unrecorded, authored],
    });

    await syncSeriesOccurrencesContract("series-1", harness.deps);

    expect(harness.deletes).toEqual([
      {
        seriesId: "series-1",
        recordingLink: null,
        zoomOccurrenceId: { notIn: [], not: null },
      },
    ]);
    expect(harness.occurrences.map((row) => row.id)).toEqual(["recorded", "authored"]);
  });

  it("SC-c: identical Zoom occurrence epochs remain isolated between different series", async () => {
    const sharedOccurrence = {
      occurrence_id: "1791219600000",
      start_time: "2026-10-05T18:00:00.000Z",
      duration: 30,
      status: "available",
    };
    const harness = syncHarness({
      series: [
        series(),
        series({
          id: "series-2",
          title: "Second Check-in",
          zoomLink: "https://zoom.us/j/900100201",
          zoomMeetingId: "900100201",
        }),
      ],
      meetings: {
        "900100200": zoomMeeting([sharedOccurrence]),
        "900100201": zoomMeeting([sharedOccurrence], {
          id: 900100201,
          topic: "Second Check-in",
          join_url: "https://zoom.us/j/900100201",
        }),
      },
    });

    await syncSeriesOccurrencesContract("series-1", harness.deps);
    await syncSeriesOccurrencesContract("series-2", harness.deps);

    expect(harness.occurrences).toHaveLength(2);
    expect(harness.occurrences.map((row) => ({
      seriesId: row.seriesId,
      zoomOccurrenceId: row.zoomOccurrenceId,
      meetingLink: row.meetingLink,
    }))).toEqual([
      {
        seriesId: "series-1",
        zoomOccurrenceId: "1791219600000",
        meetingLink: "https://zoom.us/j/900100200",
      },
      {
        seriesId: "series-2",
        zoomOccurrenceId: "1791219600000",
        meetingLink: "https://zoom.us/j/900100201",
      },
    ]);
  });

  it('SC-d: syncSeriesOccurrences filters out occurrences with status "deleted"', async () => {
    const harness = syncHarness({
      series: [series()],
      meetings: {
        "900100200": zoomMeeting([
          {
            occurrence_id: "active",
            start_time: "2026-10-05T18:00:00.000Z",
            duration: 30,
            status: "available",
          },
          {
            occurrence_id: "cancelled",
            start_time: "2026-10-06T18:00:00.000Z",
            duration: 30,
            status: "deleted",
          },
        ]),
      },
    });

    const count = await syncSeriesOccurrencesContract("series-1", harness.deps);

    expect(count).toBe(1);
    expect(harness.occurrences.map((row) => row.zoomOccurrenceId)).toEqual(["active"]);
    expect(harness.upserts).toHaveLength(1);
  });

  it("SC-e: a Zoom webhook series meeting writes SeriesOccurrence.recordingLink and creates no lesson or program rows", async () => {
    const occurrence = {
      id: "occurrence-on-recording-day",
      seriesId: "series-1",
      title: "Check-in 1",
      date: new Date("2026-10-06T18:00:00.000Z"),
      startTime: "2026-10-06T18:00:00.000Z",
      endTime: "2026-10-06T18:30:00.000Z",
      timezone: "America/Los_Angeles",
      status: "completed",
      meetingLink: "https://zoom.us/j/900100200",
      recordingLink: null,
      zoomOccurrenceId: "1791306000000",
    } satisfies OccurrenceRow;
    let cohortLookups = 0;
    let lessonCreates = 0;
    let programWrites = 0;
    const occurrenceUpdates: Array<Record<string, unknown>> = [];
    const deps = {
      db: {
        sessionSeries: {
          findUnique: async ({ where }: { where: { zoomMeetingId: string } }) =>
            where.zoomMeetingId === "900100200" ? { id: "series-1" } : null,
        },
        seriesOccurrence: {
          findFirst: async ({ where }: {
            where: { seriesId: string; date: { gte: Date; lte: Date } };
          }) => {
            expect(where.seriesId).toBe("series-1");
            expect(where.date.gte.toISOString()).toBe("2026-10-06T00:00:00.000Z");
            expect(where.date.lte.toISOString()).toBe("2026-10-06T23:59:59.999Z");
            return occurrence.date >= where.date.gte && occurrence.date <= where.date.lte
              ? occurrence
              : null;
          },
          update: async (args: {
            where: { id: string };
            data: { recordingLink: string };
          }) => {
            occurrenceUpdates.push(args);
            occurrence.recordingLink = args.data.recordingLink;
            return occurrence;
          },
        },
        cohort: {
          findFirst: async () => {
            cohortLookups += 1;
            return null;
          },
        },
      },
      syncRecordingsToProgram: async () => {
        // The existing cohort importer is the only webhook path that creates lessons
        // and updates programs. A series match must return before invoking it.
        lessonCreates += 1;
        programWrites += 1;
      },
    } satisfies SeriesRecordingDeps;

    const result = await handleZoomRecordingCompletedContract(
      {
        meetingId: "900100200",
        recordingStart: "2026-10-06T23:50:00.000Z",
        recordingLink: "https://zoom.us/rec/share/series-recording",
      },
      deps,
    );

    expect(result).toBe("series");
    expect(occurrenceUpdates).toEqual([
      {
        where: { id: "occurrence-on-recording-day" },
        data: { recordingLink: "https://zoom.us/rec/share/series-recording" },
      },
    ]);
    expect(occurrence.recordingLink).toBe("https://zoom.us/rec/share/series-recording");
    expect(cohortLookups).toBe(0);
    expect(lessonCreates).toBe(0);
    expect(programWrites).toBe(0);
  });

  it("SC-f: a Zoom webhook cohort meeting falls through to the existing cohort recording import with unchanged arguments", async () => {
    const imports: Array<[string, string, string]> = [];
    const cohortQueries: Array<Record<string, unknown>> = [];
    const deps = {
      db: {
        sessionSeries: {
          findUnique: async () => null,
        },
        seriesOccurrence: {
          findFirst: async () => null,
          update: async () => {
            throw new Error("A cohort recording must not update a SeriesOccurrence");
          },
        },
        cohort: {
          findFirst: async (args: { where: { zoomLink: { contains: string } } }) => {
            cohortQueries.push(args);
            return {
              id: "cohort-1",
              rawProgramId: "raw-program-1",
            };
          },
        },
      },
      syncRecordingsToProgram: async (
        meetingId: string,
        cohortId: string,
        rawProgramId: string,
      ) => {
        imports.push([meetingId, cohortId, rawProgramId]);
      },
    } satisfies SeriesRecordingDeps;

    const result = await handleZoomRecordingCompletedContract(
      {
        meetingId: "81234567890",
        recordingStart: "2026-10-06T18:00:00.000Z",
        recordingLink: "https://zoom.us/rec/share/cohort-recording",
      },
      deps,
    );

    expect(result).toBe("cohort");
    expect(cohortQueries).toEqual([
      { where: { zoomLink: { contains: "81234567890" } } },
    ]);
    expect(imports).toEqual([
      ["81234567890", "cohort-1", "raw-program-1"],
    ]);
  });

  it("SC-g: provisionSeriesZoom bounds a rolling series by horizonWeeks and passes parsed weekdays through", async () => {
    const createCalls: CreateZoomMeetingInput[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const createdMeeting: CreatedZoomMeeting = {
      id: 900100200,
      joinUrl: "https://zoom.us/j/900100200",
      startUrl: "https://zoom.us/s/900100200",
      password: null,
    };
    const deps = {
      db: {
        sessionSeries: {
          findUnique: async ({ where }: { where: { id: string } }) =>
            where.id === "series-1" ? series() : null,
          update: async (args: {
            where: { id: string };
            data: { zoomLink: string; zoomMeetingId: string };
          }) => {
            updates.push(args);
            return { ...series(), ...args.data };
          },
        },
      },
      createZoomMeeting: async (input: CreateZoomMeetingInput) => {
        createCalls.push(input);
        return createdMeeting;
      },
    } satisfies SeriesProvisionDeps;

    const result = await provisionSeriesZoomContract(
      "series-1",
      { horizonWeeks: 12 },
      deps,
    );

    expect(result).toEqual(createdMeeting);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual({
      topic: "Daily Check-in",
      firstSessionStartLocal: "2026-10-05T11:00:00",
      durationMinutes: 30,
      timezone: "America/Los_Angeles",
      // 12 weeks from Mon 5 Oct, end-exclusive: the Sunday before the 13th Monday.
      // Ending on 12-28 (start + 12*7) would add a 61st occurrence and Zoom would
      // reject the whole meeting — see seriesHorizonEnd.
      lastSessionDate: new Date("2026-12-27T00:00:00.000Z"),
      days: ["MON", "TUE", "WED", "THU", "FRI"],
    });
    expect(updates).toEqual([
      {
        where: { id: "series-1" },
        data: {
          zoomLink: "https://zoom.us/j/900100200",
          zoomMeetingId: "900100200",
        },
      },
    ]);
  });
});

// ── Horizon vs Zoom's 60-occurrence cap ────────────────────────────────────────
// These use the REAL countOccurrences rather than a mocked createZoomMeeting: the
// original 12-week default produced 61 occurrences and Zoom rejects the whole
// meeting, but every provisioning test mocked that call and so never saw it.
describe("seriesHorizonEnd", () => {
  const MON = new Date("2026-10-05T00:00:00.000Z"); // a Monday

  it("keeps a five-day-a-week rolling series under Zoom's 60-occurrence cap", () => {
    const end = seriesHorizonEnd(MON, DEFAULT_HORIZON_WEEKS);
    const count = countOccurrences(MON, end, ["MON", "TUE", "WED", "THU", "FRI"]);
    expect(count).toBeLessThanOrEqual(60);
    expect(count).toBe(DEFAULT_HORIZON_WEEKS * 5);
  });

  it("makes N weeks mean exactly N x (days per week), not one extra", () => {
    // The off-by-one that bit: startDate + weeks*7 lands on the same weekday again.
    const end = seriesHorizonEnd(MON, 12);
    expect(countOccurrences(MON, end, ["MON", "TUE", "WED", "THU", "FRI"])).toBe(60);
    expect(countOccurrences(MON, end, ["MON", "WED"])).toBe(24);
  });

  it("stays under the cap for a six-day week at the default horizon", () => {
    const end = seriesHorizonEnd(MON, DEFAULT_HORIZON_WEEKS);
    expect(
      countOccurrences(MON, end, ["MON", "TUE", "WED", "THU", "FRI", "SAT"]),
    ).toBeLessThanOrEqual(60);
  });
});

// ── Malformed recording events must be acknowledged, not retried ──────────────
// Zoom retries any non-2xx response. A permanently malformed event can never be
// repaired by a retry, so it is logged and acked; only transient failures throw.
describe("handleZoomRecordingCompleted — malformed payloads", () => {
  function recordingDeps(series: unknown): SeriesRecordingDeps {
    return {
      db: {
        sessionSeries: { findUnique: async () => series },
        seriesOccurrence: {
          findFirst: async () => {
            throw new Error("must not be reached for a malformed payload");
          },
          update: async () => {
            throw new Error("must not write a recording link from a malformed payload");
          },
        },
      },
    } as unknown as SeriesRecordingDeps;
  }

  const series = { id: "series-1", zoomMeetingId: "999" };

  it("ignores an event with no meeting id instead of throwing", async () => {
    await expect(
      handleZoomRecordingCompleted(
        { meetingId: "  ", recordingStart: "2026-10-05T18:00:00Z", recordingLink: "https://z/rec" },
        recordingDeps(null),
      ),
    ).resolves.toBe("ignored");
  });

  it("acks an unparseable recording start without writing anything", async () => {
    await expect(
      handleZoomRecordingCompleted(
        { meetingId: "999", recordingStart: "not-a-date", recordingLink: "https://z/rec" },
        recordingDeps(series),
      ),
    ).resolves.toBe("series");
  });

  it("acks an empty recording link without writing anything", async () => {
    await expect(
      handleZoomRecordingCompleted(
        { meetingId: "999", recordingStart: "2026-10-05T18:00:00Z", recordingLink: "   " },
        recordingDeps(series),
      ),
    ).resolves.toBe("series");
  });
});
