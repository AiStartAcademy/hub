import { describe, expect, it } from "bun:test";
import { toCalendarDate, calendarDateFromParts } from "@/lib/calendarDate";

// Regression: the dashboard calendar painted the Aug 10 bootcamp cohort starting
// Aug 9 for every viewer west of UTC, because it read a UTC-midnight instant with
// local getters. These helpers must stay timezone-independent.

describe("toCalendarDate", () => {
  it("keeps the UTC calendar day for a date-only value", () => {
    // This is exactly what /api/me/cohorts serializes for a cohort starting Aug 10.
    expect(toCalendarDate("2026-08-10T00:00:00.000Z")).toBe("2026-08-10");
    expect(toCalendarDate("2026-08-28T00:00:00.000Z")).toBe("2026-08-28");
  });

  it("accepts Date objects as well as ISO strings", () => {
    expect(toCalendarDate(new Date("2026-08-10T00:00:00.000Z"))).toBe("2026-08-10");
  });

  it("is null-safe and rejects garbage without throwing", () => {
    expect(toCalendarDate(null)).toBeNull();
    expect(toCalendarDate(undefined)).toBeNull();
    expect(toCalendarDate("")).toBeNull();
    expect(toCalendarDate("not a date")).toBeNull();
  });
});

describe("calendarDateFromParts", () => {
  it("zero-pads and treats month as 0-indexed, like Date", () => {
    expect(calendarDateFromParts(2026, 7, 10)).toBe("2026-08-10");
    expect(calendarDateFromParts(2026, 0, 1)).toBe("2026-01-01");
    expect(calendarDateFromParts(2026, 11, 31)).toBe("2026-12-31");
  });
});

describe("cohort range membership (the calendar's actual comparison)", () => {
  const start = toCalendarDate("2026-08-10T00:00:00.000Z")!;
  const end = toCalendarDate("2026-08-28T00:00:00.000Z")!;
  const inRange = (day: number) => {
    const cell = calendarDateFromParts(2026, 7, day);
    return cell >= start && cell <= end;
  };

  it("starts on the 10th, not the 9th", () => {
    expect(inRange(9)).toBe(false);
    expect(inRange(10)).toBe(true);
  });

  it("ends on the 28th, not the 27th", () => {
    expect(inRange(28)).toBe(true);
    expect(inRange(29)).toBe(false);
  });

  it("covers the interior days", () => {
    expect(inRange(17)).toBe(true);
  });

  it("treats a missing end date as open-ended", () => {
    const openEnd = toCalendarDate(null);
    const cell = calendarDateFromParts(2030, 0, 1);
    expect(cell >= start && (!openEnd || cell <= openEnd)).toBe(true);
  });
});
