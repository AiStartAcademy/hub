import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  COHORT_SMS_MAX_GSM7,
  COHORT_SMS_PREFIX,
  COHORT_SMS_SUFFIX,
  normalizeSmsText,
  renderCohortMessageSms,
  smsLength,
  validateCohortMessageSms,
} from "@/lib/cohortMessages/render";

describe("cohort message SMS rendering", () => {
  it("SC-12: renders the exact branded text and counts the full message", () => {
    const text = renderCohortMessageSms("Hi {firstName}", { firstName: "Ada" });

    expect(text).toBe(`${brand.smsSenderPrefix}Hi Ada Reply STOP to opt out.`);
    expect(smsLength(text)).toEqual({ septets: brand.smsSenderPrefix.length + 29, nonGsmChars: [] });
  });

  it("SC-12: counts GSM-7 basic and extension characters in septets", () => {
    expect(smsLength("@A{")).toEqual({ septets: 4, nonGsmChars: [] });
    expect(smsLength("^{}\\[~]|\f€")).toEqual({ septets: 20, nonGsmChars: [] });
  });

  it("SC-12: accepts exactly 320 septets and rejects 321 using the full rendered text", () => {
    const wrapperSeptets = smsLength(COHORT_SMS_PREFIX + COHORT_SMS_SUFFIX).septets;
    const atLimit = "x".repeat(COHORT_SMS_MAX_GSM7 - wrapperSeptets);
    const overLimit = atLimit + "x";

    expect(validateCohortMessageSms(atLimit, {})).toEqual({
      ok: true,
      text: COHORT_SMS_PREFIX + atLimit + COHORT_SMS_SUFFIX,
      septets: 320,
    });

    const rejected = validateCohortMessageSms(overLimit, {});
    expect(rejected.ok).toBe(false);
    expect(rejected.septets).toBe(321);
    if (!rejected.ok) expect(rejected.error).toContain("320");
  });

  it("SC-12: rejects non-GSM characters and names each distinct character", () => {
    expect(smsLength("🙂漢🙂")).toEqual({
      septets: 0,
      nonGsmChars: ["🙂", "漢"],
    });

    const result = validateCohortMessageSms("Hello 🙂 and 漢", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("GSM-7");
      expect(result.error).toContain("🙂");
      expect(result.error).toContain("漢");
    }
  });

  it("SC-12: normalizes smart punctuation, whitespace, and newlines before validation", () => {
    expect(normalizeSmsText("  ‘Hi’\t— “yes”…\u00a0ok\n\n\nnext  ")).toBe(
      "'Hi' - \"yes\"... ok\n\nnext"
    );

    const result = validateCohortMessageSms("‘Hi’\t— “yes”…\u00a0ok", {});
    expect(result).toEqual({
      ok: true,
      text: `${brand.smsSenderPrefix}'Hi' - "yes"... ok Reply STOP to opt out.`,
      septets: brand.smsSenderPrefix.length + 41,
    });
  });

  it("SC-12: rejects a body that is blank before branding is added", () => {
    expect(validateCohortMessageSms(" \t\n ", {})).toEqual({
      ok: false,
      error: "SMS body is empty",
      septets: 0,
    });
    expect(validateCohortMessageSms(" {firstName} ", {})).toEqual({
      ok: false,
      error: "SMS body is empty",
      septets: 0,
    });
  });
});
