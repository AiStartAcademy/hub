import { describe, expect, it } from "bun:test";
import {
  DEFAULT_TIMEZONE,
  isWithinWindow,
  nextWindowOpening,
  normalizeWindow,
  scheduleStep,
} from "@/lib/drip/schedule";

describe("isWithinWindow", () => {
  it("treats startHour as inclusive and endHour as exclusive across timezones", () => {
    const losAngelesWindow = normalizeWindow({
      timezone: "America/Los_Angeles",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
    });
    const tokyoWindow = normalizeWindow({
      timezone: "Asia/Tokyo",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
    });

    expect(isWithinWindow(new Date("2026-01-15T17:00:00.000Z"), losAngelesWindow)).toBe(true);
    expect(isWithinWindow(new Date("2026-01-16T01:00:00.000Z"), losAngelesWindow)).toBe(false);
    expect(isWithinWindow(new Date("2026-01-15T00:00:00.000Z"), tokyoWindow)).toBe(true);
    expect(isWithinWindow(new Date("2026-01-15T08:00:00.000Z"), tokyoWindow)).toBe(false);
  });
});

describe("nextWindowOpening", () => {
  it("defers out-of-window instants and is idempotent once the instant is inside the window", () => {
    const window = normalizeWindow({
      timezone: "America/Los_Angeles",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
    });

    const afterHours = new Date("2026-01-15T01:30:00.000Z");
    const deferred = nextWindowOpening(afterHours, window);
    expect(deferred.toISOString()).toBe("2026-01-15T17:00:00.000Z");

    const insideWindow = new Date("2026-01-15T18:45:00.000Z");
    const once = nextWindowOpening(insideWindow, window);
    const twice = nextWindowOpening(once, window);
    expect(once.toISOString()).toBe(insideWindow.toISOString());
    expect(twice.toISOString()).toBe(once.toISOString());
  });
});

describe("scheduleStep", () => {
  it("adds the delay before deferring to the next window opening", () => {
    const window = normalizeWindow({
      timezone: "America/Los_Angeles",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
    });

    expect(
      scheduleStep(new Date("2026-01-15T23:30:00.000Z"), 2, window).toISOString()
    ).toBe("2026-01-16T17:00:00.000Z");
  });

  it("clamps zero, negative, and NaN delays to zero hours", () => {
    const window = normalizeWindow({
      timezone: "America/Los_Angeles",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
    });
    const afterHours = new Date("2026-01-15T01:30:00.000Z");
    const expected = "2026-01-15T17:00:00.000Z";

    expect(scheduleStep(afterHours, 0, window).toISOString()).toBe(expected);
    expect(scheduleStep(afterHours, -5, window).toISOString()).toBe(expected);
    expect(scheduleStep(afterHours, Number.NaN, window).toISOString()).toBe(expected);
  });
});

describe("normalizeWindow", () => {
  it("degrades empty and inverted windows to all-day", () => {
    const empty = normalizeWindow({
      timezone: "America/Los_Angeles",
      sendWindowStartHour: 9,
      sendWindowEndHour: 9,
    });
    const inverted = normalizeWindow({
      timezone: "America/Los_Angeles",
      sendWindowStartHour: 18,
      sendWindowEndHour: 9,
    });

    expect(empty.startHour).toBe(0);
    expect(empty.endHour).toBe(24);
    expect(inverted.startHour).toBe(0);
    expect(inverted.endHour).toBe(24);
  });

  it("falls back to the default timezone for an invalid IANA identifier", () => {
    expect(
      normalizeWindow({
        timezone: "Not/AZone",
        sendWindowStartHour: 9,
        sendWindowEndHour: 17,
      }).timezone
    ).toBe(DEFAULT_TIMEZONE);
  });
});

describe("skipWeekends", () => {
  it("skips Saturday and Sunday and lands on Monday", () => {
    const window = normalizeWindow({
      timezone: "America/Los_Angeles",
      sendWindowStartHour: 9,
      sendWindowEndHour: 17,
      skipWeekends: true,
    });

    expect(nextWindowOpening(new Date("2026-01-17T02:30:00.000Z"), window).toISOString()).toBe(
      "2026-01-19T17:00:00.000Z"
    );
  });
});
