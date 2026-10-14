import { describe, expect, it } from "bun:test";
import { SMS_OPT_IN_CONFIRMATION } from "@/lib/phone";
import {
  optInConfirmationClaimSid,
  sendSmsOptInConfirmation,
} from "@/lib/sms/optInConfirmation";

const CONSENT = new Date("2026-10-03T12:00:00.000Z");

function eligibleContact() {
  return {
    id: "contact-1",
    phone: "+14155551234",
    smsMarketingConsentAt: CONSENT,
    smsTransactionalConsentAt: null,
    smsOptOutAt: null,
  };
}

describe("SMS opt-in confirmation", () => {
  it("SC-6 accepts an async enablement check (managed secret lookup)", async () => {
    let calls = 0;
    const deps = {
      isEnabled: async () => {
        calls += 1;
        return false;
      },
      deliver: async () => "sent" as const,
      logError: () => undefined,
    };
    expect(
      await sendSmsOptInConfirmation(
        { contact: eligibleContact(), smsConsentGrantedNow: true },
        deps
      )
    ).toBe("disabled");
    expect(calls).toBe(1);
  });

  it("SC-6 a failing enablement lookup is logged and treated as off, never thrown", async () => {
    const errors: unknown[] = [];
    const deps = {
      isEnabled: async () => {
        throw new Error("database unavailable");
      },
      deliver: async () => "sent" as const,
      logError: (error: unknown) => errors.push(error),
    };
    expect(
      await sendSmsOptInConfirmation(
        { contact: eligibleContact(), smsConsentGrantedNow: true },
        deps
      )
    ).toBe("disabled");
    expect(errors).toHaveLength(1);
  });

  it("SC-6 sends once for the first SMS grant when enabled and reads enablement per call", async () => {
    let enabled = false;
    const deliveries: Array<{ contactId: string; phone: string; body: string }> = [];
    const deps = {
      isEnabled: () => enabled,
      deliver: async (delivery: { contactId: string; phone: string; body: string }) => {
        deliveries.push(delivery);
        return "sent" as const;
      },
      logError: () => undefined,
    };

    expect(
      await sendSmsOptInConfirmation(
        { contact: eligibleContact(), smsConsentGrantedNow: true },
        deps
      )
    ).toBe("disabled");
    enabled = true;
    expect(
      await sendSmsOptInConfirmation(
        { contact: eligibleContact(), smsConsentGrantedNow: true },
        deps
      )
    ).toBe("sent");
    expect(deliveries).toEqual([
      { contactId: "contact-1", phone: "+14155551234", body: SMS_OPT_IN_CONFIRMATION },
    ]);
    expect(
      await sendSmsOptInConfirmation(
        { contact: eligibleContact(), smsConsentGrantedNow: false },
        deps
      )
    ).toBe("ineligible");
    expect(deliveries).toHaveLength(1);
  });

  it("SC-6 skips STOP and invalid E.164, and logs delivery failure without throwing", async () => {
    const errors: unknown[] = [];
    const deps = {
      isEnabled: () => true,
      deliver: async () => {
        throw new Error("Twilio missing");
      },
      logError: (error: unknown) => errors.push(error),
    };

    expect(
      await sendSmsOptInConfirmation(
        { contact: { ...eligibleContact(), smsOptOutAt: CONSENT }, smsConsentGrantedNow: true },
        deps
      )
    ).toBe("ineligible");
    expect(
      await sendSmsOptInConfirmation(
        { contact: { ...eligibleContact(), phone: "not-e164" }, smsConsentGrantedNow: true },
        deps
      )
    ).toBe("ineligible");
    expect(
      await sendSmsOptInConfirmation(
        { contact: eligibleContact(), smsConsentGrantedNow: true },
        deps
      )
    ).toBe("failed");
    expect(errors).toHaveLength(1);
  });

  it("review-3/5: a number that already got the confirmation is never texted again", async () => {
    const deps = {
      isEnabled: () => true,
      // The real deliver claims the number atomically and reports a lost claim.
      deliver: async () => "duplicate" as const,
      logError: () => undefined,
    };
    expect(
      await sendSmsOptInConfirmation(
        { contact: eligibleContact(), smsConsentGrantedNow: true },
        deps
      )
    ).toBe("duplicate");
  });

  it("review-3/5: the claim key is one per phone number, not per contact", () => {
    expect(optInConfirmationClaimSid("+14155551234")).toBe("optin-confirm:+14155551234");
  });

});
