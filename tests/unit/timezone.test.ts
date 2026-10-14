import { describe, expect, it } from "bun:test";
import { isValidIanaTimezone } from "@/lib/timezone";

describe("isValidIanaTimezone", () => {
  it("accepts the zones the app actually uses", () => {
    expect(isValidIanaTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidIanaTimezone("UTC")).toBe(true);
    expect(isValidIanaTimezone("Europe/Moscow")).toBe(true);
  });

  it("rejects the abbreviations that silently fail to format", () => {
    // These are the values already sitting in schema defaults (Cohort "PT",
    // "PST") — Intl throws on them, so they must never reach User.timezone.
    expect(isValidIanaTimezone("PT")).toBe(false);
    expect(isValidIanaTimezone("PST")).toBe(false);
    expect(isValidIanaTimezone("Pacific")).toBe(false);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(isValidIanaTimezone("")).toBe(false);
    expect(isValidIanaTimezone(" ")).toBe(false);
  });

  it("rejects nonsense without throwing", () => {
    expect(isValidIanaTimezone("Not/AZone")).toBe(false);
    expect(isValidIanaTimezone("America/Los Angeles")).toBe(false);
  });

  it("is case-sensitive about the region, as IANA is", () => {
    expect(isValidIanaTimezone("america/los_angeles")).toBe(true);
    expect(isValidIanaTimezone("AMERICA/LOS_ANGELES")).toBe(true);
  });
});
