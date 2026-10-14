import { describe, expect, test } from "bun:test";
import {
  sessionInterval,
  intervalsOverlap,
  resolveIanaZone,
  localMinuteOfDay,
  localDateKey,
} from "../../src/lib/sessionInstant";

describe("resolveIanaZone", () => {
  test("passes IANA zones through", () => {
    expect(resolveIanaZone("America/New_York")).toBe("America/New_York");
  });
  test("maps the abbreviations hand-created sessions use", () => {
    expect(resolveIanaZone("PST")).toBe("America/Los_Angeles");
    expect(resolveIanaZone("pt")).toBe("America/Los_Angeles");
    expect(resolveIanaZone("ET")).toBe("America/New_York");
  });
  test("falls back to SF for unknown or empty zones", () => {
    expect(resolveIanaZone(null)).toBe("America/Los_Angeles");
    expect(resolveIanaZone("Narnia Standard Time")).toBe("America/Los_Angeles");
  });
});

describe("sessionInterval — wall-clock shape", () => {
  const base = {
    date: new Date("2026-08-17T00:00:00.000Z"),
    startTime: "10:00 AM",
    endTime: "5:00 PM",
    timezone: "PT",
  };

  test("resolves PDT wall clock to the right UTC instant", () => {
    const result = sessionInterval(base);
    expect(result).not.toBeNull();
    expect(result!.shape).toBe("wall-clock");
    // Aug 17 is PDT (UTC-7): 10:00 local == 17:00Z, 17:00 local == 00:00Z next day.
    expect(result!.startUtc.toISOString()).toBe("2026-08-17T17:00:00.000Z");
    expect(result!.endUtc.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(result!.ianaTz).toBe("America/Los_Angeles");
  });

  test("honours standard time in winter (PST, UTC-8)", () => {
    const result = sessionInterval({ ...base, date: new Date("2026-01-15T00:00:00.000Z") });
    expect(result!.startUtc.toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });

  test("keeps the stored calendar day rather than drifting a day west", () => {
    const result = sessionInterval(base);
    expect(localDateKey(result!.startUtc, result!.ianaTz)).toBe("2026-08-17");
  });

  test("falls back to a one-hour block when end is not after start", () => {
    const result = sessionInterval({ ...base, endTime: "9:00 AM" });
    expect(result!.endUtc.getTime() - result!.startUtc.getTime()).toBe(60 * 60 * 1000);
  });

  test("returns null for times this project never produced", () => {
    expect(sessionInterval({ ...base, startTime: "sometime after lunch" })).toBeNull();
  });
});

describe("sessionInterval — zoom ISO shape", () => {
  test("uses the stored instants directly", () => {
    const result = sessionInterval({
      date: new Date("2026-08-17T00:00:00.000Z"),
      startTime: "2026-08-17T17:00:00.000Z",
      endTime: "2026-08-18T00:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    expect(result!.shape).toBe("iso");
    expect(result!.startUtc.toISOString()).toBe("2026-08-17T17:00:00.000Z");
    expect(result!.endUtc.toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });

  test("both shapes describing the same class agree", () => {
    const wall = sessionInterval({
      date: new Date("2026-08-17T00:00:00.000Z"),
      startTime: "10:00 AM",
      endTime: "5:00 PM",
      timezone: "PT",
    })!;
    const iso = sessionInterval({
      date: new Date("2026-08-17T00:00:00.000Z"),
      startTime: "2026-08-17T17:00:00.000Z",
      endTime: "2026-08-18T00:00:00.000Z",
      timezone: "America/Los_Angeles",
    })!;
    expect(wall.startUtc.getTime()).toBe(iso.startUtc.getTime());
    expect(wall.endUtc.getTime()).toBe(iso.endUtc.getTime());
  });
});

describe("intervalsOverlap", () => {
  const day = sessionInterval({
    date: new Date("2026-08-17T00:00:00.000Z"),
    startTime: "10:00 AM",
    endTime: "5:00 PM",
    timezone: "PT",
  })!;
  const evening = sessionInterval({
    date: new Date("2026-08-17T00:00:00.000Z"),
    startTime: "6:00 PM",
    endTime: "9:00 PM",
    timezone: "PT",
  })!;

  test("a day cohort and an evening cohort on the same date do not overlap", () => {
    expect(intervalsOverlap(day, evening)).toBe(false);
  });

  test("genuinely clashing sessions overlap", () => {
    const clash = sessionInterval({
      date: new Date("2026-08-17T00:00:00.000Z"),
      startTime: "4:00 PM",
      endTime: "7:00 PM",
      timezone: "PT",
    })!;
    expect(intervalsOverlap(day, clash)).toBe(true);
    expect(intervalsOverlap(clash, evening)).toBe(true);
  });

  test("touching edges are not an overlap", () => {
    const backToBack = sessionInterval({
      date: new Date("2026-08-17T00:00:00.000Z"),
      startTime: "5:00 PM",
      endTime: "6:00 PM",
      timezone: "PT",
    })!;
    expect(intervalsOverlap(day, backToBack)).toBe(false);
  });
});

describe("localMinuteOfDay", () => {
  test("reads the wall clock in the session's own zone", () => {
    const evening = sessionInterval({
      date: new Date("2026-08-17T00:00:00.000Z"),
      startTime: "6:00 PM",
      endTime: "9:00 PM",
      timezone: "PT",
    })!;
    expect(localMinuteOfDay(evening.startUtc, evening.ianaTz)).toBe(18 * 60);
  });
});
