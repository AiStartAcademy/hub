import { describe, expect, it } from "bun:test";
import {
  hasAnyPhoneConsent,
  parseOnboardingPhoneConsent,
  planOnboardingConsentGrant,
} from "@/lib/onboarding-phone-consent";

const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("onboarding phone consent split", () => {
  it("SC-3 accepts only literal true flags and defaults every other value to false", () => {
    expect(
      parseOnboardingPhoneConsent({
        smsMarketing: true,
        smsTransactional: "true",
        calls: 1,
      })
    ).toEqual({ smsMarketing: true, smsTransactional: false, calls: false });
    expect(parseOnboardingPhoneConsent(undefined)).toEqual({
      smsMarketing: false,
      smsTransactional: false,
      calls: false,
    });
    expect(hasAnyPhoneConsent(parseOnboardingPhoneConsent(undefined))).toBe(false);
  });

  it("SC-4 grants only checked kinds and never clears or overwrites prior grants", () => {
    const priorMarketing = new Date("2026-01-01T00:00:00.000Z");
    expect(
      planOnboardingConsentGrant(
        {
          smsMarketingConsentAt: priorMarketing,
          smsTransactionalConsentAt: null,
          phoneConsentAt: null,
        },
        { smsMarketing: false, smsTransactional: true, calls: false },
        NOW
      )
    ).toEqual({ smsTransactionalConsentAt: NOW });

    expect(
      planOnboardingConsentGrant(
        {
          smsMarketingConsentAt: priorMarketing,
          smsTransactionalConsentAt: NOW,
          phoneConsentAt: NOW,
        },
        { smsMarketing: true, smsTransactional: false, calls: true },
        new Date("2026-10-04T12:00:00.000Z")
      )
    ).toEqual({});
  });

  it("review-1: a changed phone number carries no consent over; only boxes ticked now count", () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-10-03T12:00:00.000Z");
    // Consent belongs to the number it was given for. Number A had every
    // consent; the re-submission brings number B with only "calls" ticked.
    expect(
      planOnboardingConsentGrant(
        {
          smsMarketingConsentAt: earlier,
          smsTransactionalConsentAt: earlier,
          phoneConsentAt: earlier,
        },
        { smsMarketing: false, smsTransactional: false, calls: true },
        now,
        { phoneChanged: true }
      )
    ).toEqual({
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      phoneConsentAt: now,
    });
  });

});
