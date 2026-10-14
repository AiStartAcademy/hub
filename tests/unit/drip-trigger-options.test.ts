import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAMPAIGN_TRIGGERS,
  COHORT_MESSAGE_TRIGGER,
  LEAD_TRIGGER,
} from "@/lib/drip/constants";
import { TRIGGER_OPTIONS, triggerHelpNote } from "@/lib/drip/triggerOptions";

// Success criteria for the CampaignEditor trigger select. The engine already
// routes on BROADCAST and CERTIFICATE_ISSUED (engine.ts), but the editor only
// offered the two original triggers — a campaign carrying either new trigger
// rendered a blank select and a Save would silently rewrite it.

describe("TRIGGER_OPTIONS", () => {
  it("SC-1: offers every admin-creatable trigger exactly once", () => {
    const values = TRIGGER_OPTIONS.map((o) => o.value);
    const adminCreatableTriggers = CAMPAIGN_TRIGGERS.filter(
      (trigger) => trigger !== COHORT_MESSAGE_TRIGGER
    );
    expect([...values].sort()).toEqual([...adminCreatableTriggers].sort());
    expect(new Set(values).size).toBe(values.length);
    expect(values).not.toContain(COHORT_MESSAGE_TRIGGER);
  });

  it("SC-2: every option has a non-empty human label", () => {
    for (const option of TRIGGER_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("SC-3: every non-nurture trigger carries a help note explaining what is ignored", () => {
    for (const trigger of CAMPAIGN_TRIGGERS) {
      if (trigger === LEAD_TRIGGER) continue;
      expect(triggerHelpNote(trigger)?.trim().length ?? 0).toBeGreaterThan(20);
    }
  });

  it("SC-4: the nurture trigger needs no help note and an unknown value yields none", () => {
    expect(triggerHelpNote(LEAD_TRIGGER)).toBeNull();
    expect(triggerHelpNote("NOT_A_TRIGGER")).toBeNull();
  });
});

describe("CampaignEditor trigger select", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/app/(dashboard)/admin/contacts/campaigns/[id]/CampaignEditor.tsx"
    ),
    "utf8"
  );

  it("SC-5: renders its options from TRIGGER_OPTIONS instead of a hardcoded list", () => {
    expect(source).toContain("TRIGGER_OPTIONS");
    expect(source).not.toContain('<option value="LEAD_SEGMENT"');
    expect(source).not.toContain('<option value="COHORT_SCHEDULE"');
  });

  it("keeps managed cohort-message campaigns visible but not selectable", () => {
    expect(source).toContain("campaign.trigger === COHORT_MESSAGE_TRIGGER");
    expect(source).toContain("disabled={campaign.trigger === COHORT_MESSAGE_TRIGGER}");
  });

  it("SC-6: shows the help note for whichever trigger is selected, not only COHORT_SCHEDULE", () => {
    expect(source).toContain("triggerHelpNote(trigger)");
    expect(source).not.toContain('trigger === "COHORT_SCHEDULE" && (');
  });
});
