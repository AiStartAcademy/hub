import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { resolveEventInstants, isEventPast, eventLastDay, formatEventDateRange } = await import(
  "@/lib/venueEventTime"
);

/** Venue events store the calendar day as UTC midnight. */
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const base = {
  date: day("2026-09-12"),
  endDate: null as Date | null,
  startTime: "11:00 AM",
  endTime: "6:00 PM",
  timezone: "America/Los_Angeles",
};

describe("resolveEventInstants", () => {
  it("resolves a PDT wall clock to the right absolute instant", () => {
    const { startUtc, endUtc, startIsoLocal, endIsoLocal } = resolveEventInstants(base);
    // September is PDT (UTC-7): 11:00 local === 18:00Z.
    expect(startUtc.toISOString()).toBe("2026-09-12T18:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-09-13T01:00:00.000Z");
    expect(startIsoLocal).toBe("2026-09-12T11:00:00-07:00");
    expect(endIsoLocal).toBe("2026-09-12T18:00:00-07:00");
  });

  it("uses the PST offset in winter — the offset is not hardcoded", () => {
    const { startUtc, startIsoLocal } = resolveEventInstants({ ...base, date: day("2027-01-12") });
    // January is PST (UTC-8): 11:00 local === 19:00Z.
    expect(startUtc.toISOString()).toBe("2027-01-12T19:00:00.000Z");
    expect(startIsoLocal).toBe("2027-01-12T11:00:00-08:00");
  });

  it("ends on endDate for a multi-day event and flags isMultiDay", () => {
    const result = resolveEventInstants({ ...base, endDate: day("2026-09-13") });
    expect(result.isMultiDay).toBe(true);
    expect(result.endUtc.toISOString()).toBe("2026-09-14T01:00:00.000Z");
  });

  it("does not flag isMultiDay when endDate equals date", () => {
    expect(resolveEventInstants({ ...base, endDate: day("2026-09-12") }).isMultiDay).toBe(false);
  });

  it("falls back to a one-hour block when the end is at or before the start", () => {
    const { startUtc, endUtc } = resolveEventInstants({ ...base, endTime: "9:00 AM" });
    expect(endUtc.getTime() - startUtc.getTime()).toBe(60 * 60 * 1000);
  });

  it("degrades instead of throwing on unparseable times", () => {
    const { startUtc, endUtc } = resolveEventInstants({
      ...base,
      startTime: "sometime tonight",
      endTime: "",
    });
    // Falls back to the 7 PM default plus one hour, on the stored day.
    expect(startUtc.toISOString()).toBe("2026-09-13T02:00:00.000Z");
    expect(endUtc.getTime() - startUtc.getTime()).toBe(60 * 60 * 1000);
  });

  it("treats a null timezone as the venue's own zone", () => {
    expect(resolveEventInstants({ ...base, timezone: null }).ianaTz).toBe("America/Los_Angeles");
  });
});

describe("eventLastDay / isEventPast", () => {
  it("uses endDate when it is later than date", () => {
    expect(eventLastDay({ date: day("2026-09-12"), endDate: day("2026-09-13") })).toEqual(
      day("2026-09-13")
    );
  });

  it("ignores an endDate that is not after date", () => {
    expect(eventLastDay({ date: day("2026-09-12"), endDate: day("2026-09-11") })).toEqual(
      day("2026-09-12")
    );
  });

  it("a multi-day event is not past on its second morning", () => {
    const event = { date: day("2026-09-12"), endDate: day("2026-09-13") };
    expect(isEventPast(event, new Date("2026-09-13T15:00:00Z"))).toBe(false);
    expect(isEventPast(event, new Date("2026-09-14T00:01:00Z"))).toBe(true);
  });

  it("a single-day event is not past during its own day", () => {
    const event = { date: day("2026-09-12"), endDate: null };
    expect(isEventPast(event, new Date("2026-09-12T23:00:00Z"))).toBe(false);
    expect(isEventPast(event, new Date("2026-09-13T00:00:00Z"))).toBe(true);
  });
});

describe("formatEventDateRange", () => {
  it("renders a single day in full", () => {
    expect(formatEventDateRange({ date: day("2026-09-12"), endDate: null })).toBe(
      "Saturday, September 12, 2026"
    );
  });

  it("collapses a same-month range", () => {
    expect(formatEventDateRange({ date: day("2026-09-12"), endDate: day("2026-09-13") })).toBe(
      "September 12–13, 2026"
    );
  });

  it("spells out both months when the range crosses one", () => {
    expect(
      formatEventDateRange({ date: day("2026-08-30"), endDate: day("2026-09-01") }, { style: "short" })
    ).toBe("Aug 30 – Sep 1, 2026");
  });
});
