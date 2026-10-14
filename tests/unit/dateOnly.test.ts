import { describe, expect, it } from "bun:test";
import { normalizeDateOnly } from "@/lib/dateOnly";

describe("normalizeDateOnly", () => {
  it("accepts an ISO calendar date unchanged", () => {
    expect(normalizeDateOnly("1990-04-17")).toBe("1990-04-17");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDateOnly("  1990-04-17  ")).toBe("1990-04-17");
  });

  it.each(["", "   "])("normalizes an empty value to null", (value) => {
    expect(normalizeDateOnly(value)).toBeNull();
  });

  it.each(["2026-02-30", "2026-13-01", "17/04/1990", "1990-4-7"])(
    "rejects invalid or non-ISO date %s",
    (value) => {
      expect(() => normalizeDateOnly(value)).toThrow();
    }
  );

  it("rejects a non-string input", () => {
    expect(() => normalizeDateOnly(19900417)).toThrow();
  });
});
