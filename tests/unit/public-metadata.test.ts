import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import { cohortsMetadata, membershipMetadata } from "@/lib/publicMetadata";

describe("public page metadata", () => {
  it("uses the configured brand instead of bootcamp-specific cohort copy", () => {
    const rendered = JSON.stringify(cohortsMetadata);
    const cityNeedle = brand.address.city;

    expect(rendered).toContain(brand.name);
    expect(rendered).not.toContain(cityNeedle);
  });

  it("uses the configured brand instead of product-specific membership copy", () => {
    const rendered = JSON.stringify(membershipMetadata);
    const cityNeedle = brand.address.city;

    expect(rendered).toContain(brand.name);
    expect(rendered).not.toContain(cityNeedle);
  });
});
