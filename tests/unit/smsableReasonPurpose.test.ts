import { describe, expect, it } from "bun:test";
import { smsableReason } from "@/lib/phone";

const CONSENT = new Date("2026-10-03T12:00:00.000Z");

function contact(overrides: Record<string, unknown> = {}) {
  return {
    phone: "+14155551234",
    phoneConsentAt: CONSENT,
    smsMarketingConsentAt: null,
    smsTransactionalConsentAt: null,
    smsOptOutAt: null,
    ...overrides,
  };
}

describe("smsableReason purpose gating", () => {
  it("SC-5 prioritizes opt-out, then purpose consent, then phone validity", () => {
    expect(smsableReason(contact({ smsOptOutAt: CONSENT }), "marketing")).toBe("sms_opt_out");
    expect(smsableReason(contact(), "marketing")).toBe("no_sms_marketing_consent");
    expect(smsableReason(contact(), "transactional")).toBe("no_sms_transactional_consent");
    expect(smsableReason(contact(), "any")).toBe("no_sms_consent");
    expect(
      smsableReason(contact({ smsMarketingConsentAt: CONSENT, phone: "invalid" }), "marketing")
    ).toBe("invalid_phone");
    expect(
      smsableReason(contact({ smsMarketingConsentAt: CONSENT }), "marketing")
    ).toBeNull();
    expect(
      smsableReason(contact({ smsTransactionalConsentAt: CONSENT }), "transactional")
    ).toBeNull();
    expect(smsableReason(contact({ smsTransactionalConsentAt: CONSENT }), "any")).toBeNull();
  });

  it("SC-5 does not treat legacy call consent as SMS consent", () => {
    expect(smsableReason(contact({ phoneConsentAt: CONSENT }), "any")).toBe("no_sms_consent");
  });
});
