import { describe, expect, it } from "bun:test";
import { planPersonPhoneConsent, smsConsentGrantedBetween } from "@/lib/leads/personRecord";

const OLD = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("person phone consent split", () => {
  it("SC-8 lets self-service independently grant and withdraw all three kinds", () => {
    expect(
      planPersonPhoneConsent({
        actor: "self",
        phonePresent: true,
        existing: {
          smsMarketingConsentAt: OLD,
          smsTransactionalConsentAt: null,
          phoneConsentAt: OLD,
        },
        requested: { smsMarketing: false, smsTransactional: true, calls: true },
        now: NOW,
      })
    ).toEqual({
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: NOW,
      phoneConsentAt: OLD,
    });
  });

  it("SC-8 never lets an admin grant or withdraw SMS consent on another person's behalf", () => {
    expect(
      planPersonPhoneConsent({
        actor: "admin",
        phonePresent: true,
        existing: {
          smsMarketingConsentAt: null,
          smsTransactionalConsentAt: OLD,
          phoneConsentAt: null,
        },
        requested: { smsMarketing: true, smsTransactional: false, calls: true },
        now: NOW,
      })
    ).toEqual({
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: OLD,
      phoneConsentAt: NOW,
    });
  });

  it("SC-8 clears every consent kind when the phone is removed", () => {
    expect(
      planPersonPhoneConsent({
        actor: "self",
        phonePresent: false,
        existing: {
          smsMarketingConsentAt: OLD,
          smsTransactionalConsentAt: OLD,
          phoneConsentAt: OLD,
        },
        requested: { smsMarketing: true, smsTransactional: true, calls: true },
        now: NOW,
      })
    ).toEqual({
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      phoneConsentAt: null,
    });
  });

  it("review-4: an admin changing or clearing the phone drops SMS consent given for the old number", () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-10-03T12:00:00.000Z");
    const existing = {
      smsMarketingConsentAt: earlier,
      smsTransactionalConsentAt: earlier,
      phoneConsentAt: earlier,
    };
    const requested = { smsMarketing: true, smsTransactional: true, calls: true };
    expect(
      planPersonPhoneConsent({
        actor: "admin",
        phonePresent: true,
        phoneChanged: true,
        existing,
        requested,
        now,
      })
    ).toEqual({
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      phoneConsentAt: now,
    });
    expect(
      planPersonPhoneConsent({
        actor: "admin",
        phonePresent: false,
        phoneChanged: true,
        existing,
        requested,
        now,
      })
    ).toEqual({
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      phoneConsentAt: null,
    });
  });

  it("review-4: a person changing their own number re-stamps the consents they tick for it", () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-10-03T12:00:00.000Z");
    expect(
      planPersonPhoneConsent({
        actor: "self",
        phonePresent: true,
        phoneChanged: true,
        existing: {
          smsMarketingConsentAt: earlier,
          smsTransactionalConsentAt: earlier,
          phoneConsentAt: null,
        },
        requested: { smsMarketing: true, smsTransactional: false, calls: false },
        now,
      })
    ).toEqual({
      smsMarketingConsentAt: now,
      smsTransactionalConsentAt: null,
      phoneConsentAt: null,
    });
  });


  it("review-8: detects a newly granted SMS consent, not an unchanged or withdrawn one", () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-10-03T12:00:00.000Z");
    const none = { smsMarketingConsentAt: null, smsTransactionalConsentAt: null, phoneConsentAt: null };
    expect(smsConsentGrantedBetween(none, { ...none, smsTransactionalConsentAt: now })).toBe(true);
    expect(
      smsConsentGrantedBetween(
        { ...none, smsMarketingConsentAt: earlier },
        { ...none, smsMarketingConsentAt: earlier }
      )
    ).toBe(false);
    expect(smsConsentGrantedBetween({ ...none, smsMarketingConsentAt: earlier }, none)).toBe(false);
    // Call consent alone never triggers a text.
    expect(smsConsentGrantedBetween(none, { ...none, phoneConsentAt: now })).toBe(false);
  });

});
