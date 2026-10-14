import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { getMonthRange, overlapsMonth, expandAcrossDays } = await import(
  "@/lib/venueCalendarRange"
);

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const AUG = getMonthRange("2026-08")!;

describe("getMonthRange", () => {
  it("returns a half-open UTC window", () => {
    expect(AUG.monthStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(AUG.nextMonthStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls over the year at December", () => {
    expect(getMonthRange("2026-12")!.nextMonthStart.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z"
    );
  });

  it("rejects malformed months but allows null (current month)", () => {
    for (const bad of ["2026-13", "2026-00", "26-08", "2026-8", "August", ""]) {
      expect(getMonthRange(bad)).toBeNull();
    }
    expect(getMonthRange(null)).not.toBeNull();
  });
});

describe("overlapsMonth", () => {
  it("bounds the start day above and either end below", () => {
    const where = overlapsMonth(AUG);
    expect(where.AND[0]).toEqual({ date: { lt: AUG.nextMonthStart } });
    expect(where.AND[1]).toEqual({
      OR: [{ date: { gte: AUG.monthStart } }, { endDate: { gte: AUG.monthStart } }],
    });
  });
});

describe("expandAcrossDays", () => {
  it("leaves a single-day event as one entry", () => {
    const out = expandAcrossDays([{ date: day("2026-08-21"), endDate: null }], AUG);
    expect(out).toHaveLength(1);
    expect(out[0].dayIndex).toBe(0);
    expect(out[0].dayCount).toBe(1);
  });

  it("expands a two-day event onto both days", () => {
    const out = expandAcrossDays(
      [{ date: day("2026-08-12"), endDate: day("2026-08-13") }],
      AUG
    );
    expect(out.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-08-12",
      "2026-08-13",
    ]);
    expect(out.map((r) => r.dayIndex)).toEqual([0, 1]);
    expect(out.every((r) => r.dayCount === 2)).toBe(true);
  });

  it("clips to the requested month but keeps dayIndex absolute", () => {
    // Runs Jul 31 → Aug 2; only the August days belong in an August grid, and
    // Aug 1 must still know it is day 2 of 3.
    const out = expandAcrossDays(
      [{ date: day("2026-07-31"), endDate: day("2026-08-02") }],
      AUG
    );
    expect(out.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-08-01",
      "2026-08-02",
    ]);
    expect(out.map((r) => r.dayIndex)).toEqual([1, 2]);
    expect(out.every((r) => r.dayCount === 3)).toBe(true);
  });

  it("ignores an endDate that is not after date", () => {
    const out = expandAcrossDays(
      [{ date: day("2026-08-21"), endDate: day("2026-08-20") }],
      AUG
    );
    expect(out).toHaveLength(1);
    expect(out[0].dayCount).toBe(1);
  });

  it("carries the row's other fields through and drops endDate", () => {
    const out = expandAcrossDays(
      [{ date: day("2026-08-21"), endDate: null, title: "Salon", id: "abc" }],
      AUG
    );
    expect(out[0]).toMatchObject({ title: "Salon", id: "abc" });
    expect("endDate" in out[0]).toBe(false);
  });

  it("returns nothing when the event misses the window entirely", () => {
    expect(expandAcrossDays([{ date: day("2026-10-01"), endDate: null }], AUG)).toEqual([]);
  });
});
