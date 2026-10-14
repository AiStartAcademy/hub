import { describe, expect, it } from "bun:test";
import { countOccurrences } from "@/lib/zoom";

describe("countOccurrences", () => {
  it("counts exactly the 4 Mon-Thu sessions in a single week (the bug this fixes)", () => {
    // Aug 10, 2026 is a Monday; Aug 13 is a Thursday.
    const first = new Date("2026-08-10");
    const last = new Date("2026-08-13");
    expect(countOccurrences(first, last, ["MON", "TUE", "WED", "THU"])).toBe(4);
  });

  it("counts 12 Mon-Thu sessions across a 3-week evening cohort span (3 weeks x 4 days)", () => {
    // Aug 10 (Mon) -> Aug 28 (Fri), Mon-Thu only. NOTE: the real Luma listing's copy says
    // "11 evenings" — one less than this grid's actual 12. That's a discrepancy in the
    // marketing content itself, not this function; verify against Luma before trusting "11".
    const first = new Date("2026-08-10");
    const last = new Date("2026-08-28");
    expect(countOccurrences(first, last, ["MON", "TUE", "WED", "THU"])).toBe(12);
  });

  it("counts 10 Mon-Fri sessions across a 10-day intensive span", () => {
    // Aug 17 (Mon) -> Aug 28 (Fri), Mon-Fri.
    const first = new Date("2026-08-17");
    const last = new Date("2026-08-28");
    expect(countOccurrences(first, last, ["MON", "TUE", "WED", "THU", "FRI"])).toBe(10);
  });

  it("returns 0 when no matching weekday falls in range", () => {
    // A single-day range on a Saturday, asking only for weekdays.
    const first = new Date("2026-08-15"); // Saturday
    const last = new Date("2026-08-15");
    expect(countOccurrences(first, last, ["MON", "TUE", "WED", "THU", "FRI"])).toBe(0);
  });

  it("is inclusive of both the first and last day", () => {
    const first = new Date("2026-08-10"); // Monday
    const last = new Date("2026-08-10");
    expect(countOccurrences(first, last, ["MON"])).toBe(1);
  });
});
