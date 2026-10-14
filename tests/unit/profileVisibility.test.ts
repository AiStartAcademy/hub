import { describe, expect, it } from "bun:test";
import {
  isProfileVisibility,
  isPubliclyReachable,
  PROFILE_VISIBILITIES,
} from "@/lib/profileVisibility";

describe("isProfileVisibility", () => {
  it("accepts every known visibility", () => {
    for (const value of PROFILE_VISIBILITIES) {
      expect(isProfileVisibility(value)).toBe(true);
    }
  });

  it("rejects unknown strings rather than letting them persist", () => {
    expect(isProfileVisibility("VISIBLE")).toBe(false);
    expect(isProfileVisibility("public")).toBe(false); // callers must upper-case first
    expect(isProfileVisibility("")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isProfileVisibility(null)).toBe(false);
    expect(isProfileVisibility(undefined)).toBe(false);
    expect(isProfileVisibility(1)).toBe(false);
    expect(isProfileVisibility({})).toBe(false);
  });
});

describe("isPubliclyReachable", () => {
  it("treats PUBLIC and UNLISTED as reachable by an outsider", () => {
    expect(isPubliclyReachable("PUBLIC")).toBe(true);
    expect(isPubliclyReachable("UNLISTED")).toBe(true);
  });

  it("treats PRIVATE and missing values as not reachable", () => {
    expect(isPubliclyReachable("PRIVATE")).toBe(false);
    expect(isPubliclyReachable(null)).toBe(false);
    expect(isPubliclyReachable(undefined)).toBe(false);
  });
});
