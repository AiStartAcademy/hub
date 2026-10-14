import { describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

mock.module("@/lib/prisma", () => ({ default: {} }));

const {
  appliesCohortStartGuard,
  campaignSkipsStatusExits,
  campaignUsesAllDaySendWindow,
  smsableReason,
  smsPurposeForCampaignTrigger,
  unsubscribeHeaders,
  unsubscribeUrl,
} = await import("@/lib/drip/engine");
const { renderSmsBody } = await import("@/lib/sms/render");

describe("unsubscribeHeaders", () => {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  it("SC2.1: returns RFC 8058 one-click List-Unsubscribe headers", () => {
    expect(unsubscribeHeaders("tok-123", brand.email.contact)).toEqual({
      "List-Unsubscribe": `<mailto:${brand.email.contact}?subject=unsubscribe>, <${appUrl}/api/unsubscribe?token=tok-123>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("SC2.2: percent-encodes a token with URL-unsafe characters", () => {
    const headers = unsubscribeHeaders("a+b/c=d", brand.email.contact);
    expect(headers["List-Unsubscribe"]).toContain(
      `<${appUrl}/api/unsubscribe?token=a%2Bb%2Fc%3Dd>`
    );
  });

  it("SC2.3: points the POST endpoint at the same origin as the click-through page", () => {
    const headers = unsubscribeHeaders("tok-123", brand.email.contact);
    expect(unsubscribeUrl("tok-123")).toBe(`${appUrl}/unsubscribe?token=tok-123`);
    expect(headers["List-Unsubscribe"]).toContain(`<${appUrl}/api/unsubscribe?token=tok-123>`);
  });
});

describe("drip engine certificate delivery", () => {
  it("CERTIFICATE_ISSUED enrollment bypasses status exits and send window, still honors unsubscribe", () => {
    expect(campaignSkipsStatusExits("CERTIFICATE_ISSUED")).toBe(true);
    expect(campaignSkipsStatusExits("MANUAL")).toBe(false);
    expect(campaignUsesAllDaySendWindow("CERTIFICATE_ISSUED")).toBe(true);
  });

  it("CERTIFICATE_ISSUED step is never skipped by the COHORT_START past-due guard", () => {
    expect(appliesCohortStartGuard("CERTIFICATE_ISSUED", "COHORT_START")).toBe(false);
    expect(appliesCohortStartGuard("COHORT_SCHEDULE", "COHORT_START")).toBe(true);
  });

  it("SMS step renders {{certificate_url}} and is SKIPPED without SMS consent", () => {
    expect(
      renderSmsBody("Certificate: {{certificate_url}}", {
        certificateUrl: `${brand.urls.hub}/certificates/cert-1`,
      })
    ).toBe(`Certificate: ${brand.urls.hub}/certificates/cert-1`);
    const contactWithoutSmsConsent: Parameters<typeof smsableReason>[0] = {
      phone: null,
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      smsOptOutAt: null,
    };
    // A certificate notice is a service message, gated on transactional consent.
    const purpose = smsPurposeForCampaignTrigger("CERTIFICATE_ISSUED");
    expect(purpose).toBe("transactional");
    expect(smsableReason(contactWithoutSmsConsent, purpose)).toBe(
      "no_sms_transactional_consent"
    );
  });
});

describe("SMS token safety", () => {
  it("renders {{cohort_name}} in SMS bodies", () => {
    expect(
      renderSmsBody("Your {{cohort_name}} certificate is live", {
        cohortName: "10-Day Intensive",
      })
    ).toBe("Your 10-Day Intensive certificate is live");
  });

  it("strips unknown tokens instead of texting them literally", () => {
    expect(renderSmsBody("Hi {{first_name}}{{totally_made_up}}!", { firstName: "Lex" })).toBe(
      "Hi Lex!"
    );
  });
});
