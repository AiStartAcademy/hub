import { describe, expect, test } from "bun:test";
import {
  mergeSchedule,
  normalizeSeriesDays,
  SeriesInputError,
  seriesVisibilityFilter,
  toInputTime,
  toWallClock,
  type ScheduleEntry,
} from "@/lib/seriesSchedule";

function entry(over: Partial<ScheduleEntry> & { startTime: string }): ScheduleEntry {
  return {
    id: over.id ?? "x",
    kind: over.kind ?? "cohort",
    title: over.title ?? "t",
    context: over.context ?? "c",
    date: over.date ?? new Date(over.startTime),
    startTime: over.startTime,
    endTime: over.endTime ?? over.startTime,
    timezone: over.timezone ?? "America/Los_Angeles",
    status: over.status ?? "upcoming",
    meetingLink: over.meetingLink ?? null,
    recordingLink: over.recordingLink ?? null,
    instructorId: over.instructorId ?? null,
  };
}

describe("seriesVisibilityFilter", () => {
  test("a student sees only series attached to a cohort they are actively enrolled in", () => {
    const f = seriesVisibilityFilter({ userId: "u1", role: "STUDENT" });
    expect(f.status).toBe("ACTIVE");
    expect(f.cohorts).toEqual({
      some: { cohort: { enrollments: { some: { userId: "u1", status: "active" } } } },
    });
    // Critically, a student must never get the instructor OR-branch.
    expect(f.OR).toBeUndefined();
  });

  test("an instructor sees series they lead, occurrences assigned to them, and their cohorts'", () => {
    const f = seriesVisibilityFilter({ userId: "i1", role: "INSTRUCTOR" });
    expect(f.OR).toHaveLength(3);
    expect(f.OR).toContainEqual({ instructorId: "i1" });
    expect(f.OR).toContainEqual({ occurrences: { some: { instructorId: "i1" } } });
  });

  test("admin and team members are constrained only to ACTIVE series", () => {
    for (const role of ["ADMIN", "TEAM_MEMBER"]) {
      const f = seriesVisibilityFilter({ userId: "a1", role });
      expect(f).toEqual({ status: "ACTIVE" });
    }
  });

  test("a paused or archived series is never visible to anyone through this filter", () => {
    for (const role of ["STUDENT", "INSTRUCTOR", "ADMIN"]) {
      expect(seriesVisibilityFilter({ userId: "u", role }).status).toBe("ACTIVE");
    }
  });
});

describe("mergeSchedule", () => {
  test("interleaves cohort sessions and series occurrences chronologically", () => {
    const cohort = [
      entry({ id: "c1", startTime: "2026-09-21T17:00:00.000Z" }),
      entry({ id: "c2", startTime: "2026-09-23T17:00:00.000Z" }),
    ];
    const series = [
      entry({ id: "s1", kind: "series", startTime: "2026-09-22T18:00:00.000Z" }),
      entry({ id: "s2", kind: "series", startTime: "2026-09-21T18:00:00.000Z" }),
    ];
    expect(mergeSchedule(cohort, series).map((e) => e.id)).toEqual(["c1", "s2", "s1", "c2"]);
  });

  test("respects the take limit after merging, not before", () => {
    const cohort = [entry({ id: "c1", startTime: "2026-09-25T17:00:00.000Z" })];
    const series = [entry({ id: "s1", kind: "series", startTime: "2026-09-20T17:00:00.000Z" })];
    // Naive concat-then-slice would return c1; the earlier series entry must win.
    expect(mergeSchedule(cohort, series, 1).map((e) => e.id)).toEqual(["s1"]);
  });

  test("falls back to `date` when startTime is not a parseable ISO string", () => {
    const legacy = [
      entry({ id: "legacy", startTime: "6:00 PM", date: new Date("2026-09-20T01:00:00.000Z") }),
    ];
    const modern = [entry({ id: "s1", kind: "series", startTime: "2026-09-21T18:00:00.000Z" })];
    expect(mergeSchedule(legacy, modern).map((e) => e.id)).toEqual(["legacy", "s1"]);
  });
});

describe("normalizeSeriesDays", () => {
  test("parses a CSV string into canonical week-ordered codes", () => {
    expect(normalizeSeriesDays("MON,TUE,WED,THU,FRI")).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
  });

  test("sorts into week order and dedupes, so THU,MON and MON,THU are one schedule", () => {
    expect(normalizeSeriesDays("THU,MON,MON")).toEqual(["MON", "THU"]);
    expect(normalizeSeriesDays(["mon", "thu"])).toEqual(["MON", "THU"]);
  });

  test("throws on an unrecognised weekday rather than silently dropping it", () => {
    expect(() => normalizeSeriesDays("MON,FUNDAY")).toThrow(/Unrecognised weekday/);
  });

  test("throws a typed SeriesInputError so routes map it to 400 by type, not by message", () => {
    // Matching on message text would turn an unrelated internal error whose wording
    // happened to mention a weekday into a 400.
    expect(() => normalizeSeriesDays("MON,FUNDAY")).toThrow(SeriesInputError);
    expect(() => normalizeSeriesDays("")).toThrow(SeriesInputError);
  });

  test("throws on empty input rather than defaulting to a 'usual' week", () => {
    // Guessing Mon-Fri here has already produced one wrong Zoom recurrence in this repo.
    expect(() => normalizeSeriesDays("")).toThrow(/days is required/);
    expect(() => normalizeSeriesDays(undefined)).toThrow(/days is required/);
    expect(() => normalizeSeriesDays([])).toThrow(/days is required/);
  });
});

describe("toWallClock / toInputTime", () => {
  test("converts a 24h input value to the stored wall-clock form", () => {
    expect(toWallClock("18:00")).toBe("6:00 PM");
    expect(toWallClock("09:30")).toBe("9:30 AM");
    expect(toWallClock("11:00")).toBe("11:00 AM");
  });

  test("handles midnight and noon, which naive h % 12 gets wrong", () => {
    expect(toWallClock("00:00")).toBe("12:00 AM");
    expect(toWallClock("00:45")).toBe("12:45 AM");
    expect(toWallClock("12:00")).toBe("12:00 PM");
    expect(toWallClock("12:30")).toBe("12:30 PM");
  });

  test("round-trips every hour of the day", () => {
    for (let h = 0; h < 24; h++) {
      const input = `${String(h).padStart(2, "0")}:15`;
      expect(toInputTime(toWallClock(input))).toBe(input);
    }
  });

  test("passes unparseable values through untouched rather than corrupting them", () => {
    expect(toWallClock("not a time")).toBe("not a time");
    expect(toInputTime("not a time")).toBe("not a time");
  });
});
