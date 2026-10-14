import { describe, expect, it } from "bun:test";
import { planSmsConsentBackfill } from "@/lib/sms/backfill";

const LEGACY = new Date("2026-01-01T00:00:00.000Z");
const CUTOFF = new Date("2026-06-01T00:00:00.000Z");
const AFTER_CUTOFF = new Date("2026-06-02T00:00:00.000Z");

describe("SMS consent backfill planner", () => {
  it("SC-9 copies legacy call consent into both SMS fields only when both are null", () => {
    expect(
      planSmsConsentBackfill({
        phoneConsentAt: LEGACY,
        updatedAt: LEGACY,
        smsMarketingConsentAt: null,
        smsTransactionalConsentAt: null,
      }, CUTOFF)
    ).toEqual({
      smsMarketingConsentAt: LEGACY,
      smsTransactionalConsentAt: LEGACY,
    });
    expect(
      planSmsConsentBackfill({
        phoneConsentAt: LEGACY,
        updatedAt: LEGACY,
        smsMarketingConsentAt: LEGACY,
        smsTransactionalConsentAt: null,
      }, CUTOFF)
    ).toBeNull();
    expect(
      planSmsConsentBackfill({
        phoneConsentAt: null,
        updatedAt: LEGACY,
        smsMarketingConsentAt: null,
        smsTransactionalConsentAt: null,
      }, CUTOFF)
    ).toBeNull();
  });

  it("SC-9 never widens call-only consent given on or after the split form went live", () => {
    // After the cutoff, phoneConsentAt means "calls only": the person saw the
    // separate SMS checkboxes and left them unticked.
    expect(
      planSmsConsentBackfill(
        {
          phoneConsentAt: AFTER_CUTOFF,
          updatedAt: LEGACY,
          smsMarketingConsentAt: null,
          smsTransactionalConsentAt: null,
        },
        CUTOFF
      )
    ).toBeNull();
    expect(
      planSmsConsentBackfill(
        {
          phoneConsentAt: CUTOFF,
          updatedAt: LEGACY,
          smsMarketingConsentAt: null,
          smsTransactionalConsentAt: null,
        },
        CUTOFF
      )
    ).toBeNull();
  });

  it("review-2: skips any contact touched since the split form went live", () => {
    // A withdrawal, a settings save or a quiz re-submission after go-live all
    // bump updatedAt. Their SMS fields are null on purpose, not by legacy.
    expect(
      planSmsConsentBackfill(
        {
          phoneConsentAt: LEGACY,
          updatedAt: AFTER_CUTOFF,
          smsMarketingConsentAt: null,
          smsTransactionalConsentAt: null,
        },
        CUTOFF
      )
    ).toBeNull();
  });

});
