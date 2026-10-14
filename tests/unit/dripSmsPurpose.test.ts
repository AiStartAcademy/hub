import { describe, expect, it } from "bun:test";
import { smsPurposeForCampaignTrigger } from "@/lib/drip/engine";

describe("drip SMS purpose", () => {
  it("SC-5 maps cohort schedules and certificate notices to transactional, everything else to marketing", () => {
    expect(smsPurposeForCampaignTrigger("COHORT_SCHEDULE")).toBe("transactional");
    expect(smsPurposeForCampaignTrigger("LEAD_SEGMENT")).toBe("marketing");
    expect(smsPurposeForCampaignTrigger("BROADCAST")).toBe("marketing");
    expect(smsPurposeForCampaignTrigger("CERTIFICATE_ISSUED")).toBe("transactional");
    expect(smsPurposeForCampaignTrigger("MANUAL")).toBe("marketing");
  });
});
