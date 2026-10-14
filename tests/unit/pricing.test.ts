import { describe, expect, it } from "bun:test";

import { formatMonthlyPrice } from "@/lib/pricing";

describe("formatMonthlyPrice", () => {
  it("SC-3 omits cents for whole-dollar monthly prices", () => {
    expect(formatMonthlyPrice(5000)).toBe("$50/mo");
    expect(formatMonthlyPrice(50000)).toBe("$500/mo");
  });

  it("SC-3 preserves cents for fractional-dollar monthly prices", () => {
    expect(formatMonthlyPrice(4999)).toBe("$49.99/mo");
  });
});
