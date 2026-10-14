import { describe, expect, it } from "bun:test";
import {
  hasAttribution,
  parseAttribution,
  parseAttributionCookie,
  parseSegmentCookie,
  type Attribution,
} from "@/lib/attribution";

describe("parseAttribution", () => {
  it("extracts UTM params and click ids", () => {
    const params = new URLSearchParams(
      "utm_source=meta&utm_campaign=summer&fbclid=xyz&unrelated=1"
    );
    expect(parseAttribution(params)).toEqual({
      utm_source: "meta",
      utm_campaign: "summer",
      fbclid: "xyz",
    });
  });

  it("ignores unknown params", () => {
    const params = new URLSearchParams("foo=bar&baz=qux");
    expect(parseAttribution(params)).toEqual({});
  });

  it("SC3.5: ignores the onboarding step query param", () => {
    const params = new URLSearchParams("step=contact-details&utm_source=meta");
    expect(parseAttribution(params)).toEqual({ utm_source: "meta" });
  });

  it("caps values at 500 characters", () => {
    const long = "a".repeat(600);
    const params = new URLSearchParams(`utm_term=${long}`);
    expect(parseAttribution(params).utm_term).toHaveLength(500);
  });
});

describe("hasAttribution", () => {
  it("is true when any known signal is present", () => {
    expect(hasAttribution({ gclid: "abc" })).toBe(true);
  });

  it("is false for an empty object", () => {
    expect(hasAttribution({})).toBe(false);
  });

  it("is false when only non-signal fields are present", () => {
    const attr: Attribution = { referrer: "https://x.com", landing_page: "/" };
    expect(hasAttribution(attr)).toBe(false);
  });
});

describe("parseAttributionCookie", () => {
  it("returns null for empty input", () => {
    expect(parseAttributionCookie(null)).toBeNull();
    expect(parseAttributionCookie(undefined)).toBeNull();
    expect(parseAttributionCookie("")).toBeNull();
  });

  it("parses URI-encoded JSON", () => {
    const raw = encodeURIComponent(JSON.stringify({ utm_source: "meta" }));
    expect(parseAttributionCookie(raw)).toEqual({ utm_source: "meta" });
  });

  it("parses plain (non-encoded) JSON", () => {
    expect(parseAttributionCookie('{"gclid":"abc"}')).toEqual({ gclid: "abc" });
  });

  it("returns null on malformed input", () => {
    expect(parseAttributionCookie("not json")).toBeNull();
  });
});

describe("parseSegmentCookie", () => {
  it("returns null for empty or whitespace-only input", () => {
    expect(parseSegmentCookie(null)).toBeNull();
    expect(parseSegmentCookie("   ")).toBeNull();
  });

  it("trims and returns a normal value", () => {
    expect(parseSegmentCookie("  founders  ")).toBe("founders");
  });

  it("caps length at 100 characters", () => {
    expect(parseSegmentCookie("x".repeat(150))).toHaveLength(100);
  });
});
