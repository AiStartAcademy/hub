import { describe, expect, test } from "bun:test";

import { content, type Content } from "@/config/content";
import {
  MEMBERSHIP_TIER_IDS,
  MEMBERSHIP_TIERS,
} from "@/lib/membershipTiers";

describe("business content config", () => {
  test("has a typed, internally valid shape", () => {
    const configured = content satisfies Content;

    for (const testimonial of configured.testimonials) {
      expect(testimonial.youtubeId).toBeString();
      expect(testimonial.role).toBeString();
      if (testimonial.quote !== undefined) expect(testimonial.quote).toBeString();
      if (testimonial.name !== undefined) expect(testimonial.name).toBeString();
      if (testimonial.featured !== undefined) expect(testimonial.featured).toBeBoolean();
    }

    expect(Number.isInteger(configured.selfPacedProgram.priceCents)).toBe(true);
    expect(configured.selfPacedProgram.priceCents).toBeGreaterThanOrEqual(0);

    const tierIds = configured.membershipTiers.map((tier) => tier.id);
    expect(new Set(tierIds).size).toBe(tierIds.length);
    for (const tier of configured.membershipTiers) {
      expect(MEMBERSHIP_TIER_IDS).toContain(tier.id);
      expect(tier.label).toBeString();
      expect(tier.cardTitle).toBeString();
      expect(tier.description).toBeString();
      expect(Number.isInteger(tier.amountCents)).toBe(true);
      expect(tier.amountCents).toBeGreaterThanOrEqual(0);
      expect(tier.tagline).toBeString();
      expect(tier.bestFor).toBeString();
      expect(tier.features.every((feature) => typeof feature === "string")).toBe(true);
    }
    expect(MEMBERSHIP_TIERS).toEqual(tierIds);

    expect(configured.membershipPage.perks).toBeArray();
    expect(configured.membershipPage.faq).toBeArray();
    expect(configured.locations.description).toBeString();
    if (configured.scholarshipsPerCohort !== undefined) {
      expect(Number.isInteger(configured.scholarshipsPerCohort)).toBe(true);
      expect(configured.scholarshipsPerCohort).toBeGreaterThanOrEqual(0);
    }
  });

  test("allows optional cohort-page strings to be empty", () => {
    const blank: Content["cohortsPage"] = {
      tagline: "",
      communityEventsLabel: "",
      scholarshipNote: "",
    };
    expect(Object.values(blank)).toEqual(["", "", ""]);
  });

  test("module is client-safe", async () => {
    const source = await Bun.file(new URL("../../src/config/content.ts", import.meta.url)).text();
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("node:");
  });
});
