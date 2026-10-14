import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  CALL_CONSENT_DISCLOSURE,
  PRIVACY_POLICY_URL,
  SMS_MARKETING_CONSENT_DISCLOSURE,
  SMS_OPT_IN_CONFIRMATION,
  SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
  TERMS_OF_SERVICE_URL,
} from "@/lib/phone";

describe("A2P consent disclosures", () => {
  it("SC-2 exports the approved disclosure copy and policy URLs exactly", () => {
    expect(SMS_MARKETING_CONSENT_DISCLOSURE).toBe(
      `I agree to receive marketing text messages from ${brand.wordmark}, such as course and bootcamp follow-ups, offers, and new cohort announcements. Message frequency varies (up to 4 msgs/month). Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of any purchase.`
    );
    expect(SMS_TRANSACTIONAL_CONSENT_DISCLOSURE).toBe(
      `I agree to receive non-marketing text messages from ${brand.wordmark}, such as reminders about my cohort start dates and class sessions. Message frequency varies (up to 10 msgs/month). Msg & data rates may apply. Reply HELP for help, STOP to opt out.`
    );
    expect(CALL_CONSENT_DISCLOSURE).toBe(
      `I agree to receive phone calls from ${brand.wordmark} about my request, including calls placed by an automated/AI assistant.`
    );
    expect(SMS_OPT_IN_CONFIRMATION).toBe(
      `${brand.smsSenderPrefix}You're subscribed to text updates. Up to 10 msgs/month. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`
    );
    expect(TERMS_OF_SERVICE_URL).toBe(brand.urls.termsOfService);
    expect(PRIVACY_POLICY_URL).toBe(brand.urls.privacyPolicy);
  });
});
