import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";
import {
  normalizeDripSettings,
  normalizeDripStep,
  normalizeDripStepSequence,
  type DripStepInput,
} from "@/lib/drip/admin";

function step(overrides: Partial<DripStepInput> = {}): DripStepInput {
  return {
    delayHours: 48,
    channel: "EMAIL",
    subject: "Welcome",
    body: "<p>Hello</p>",
    ctaLabel: "Join now",
    ctaUrl: "{{cohorts_url}}",
    ...overrides,
  };
}

describe("normalizeDripStep", () => {
  it("keeps a supported CTA merge field URL and label intact without warnings", () => {
    const result = normalizeDripStep(step());

    expect(result.step.ctaLabel).toBe("Join now");
    expect(result.step.ctaUrl).toBe("{{cohorts_url}}");
    expect(result.warnings).toEqual([]);
  });

  it("allows inner whitespace inside supported CTA merge field braces", () => {
    const result = normalizeDripStep(step({ ctaUrl: "{{ cohorts_url }}" }));

    expect(result.step.ctaLabel).toBe("Join now");
    expect(result.step.ctaUrl).toBe("{{ cohorts_url }}");
    expect(result.warnings).toEqual([]);
  });

  it("allows supported CTA merge field suffixes", () => {
    const result = normalizeDripStep(step({ ctaUrl: "{{app_url}}/cohorts#membership" }));

    expect(result.step.ctaLabel).toBe("Join now");
    expect(result.step.ctaUrl).toBe("{{app_url}}/cohorts#membership");
    expect(result.warnings).toEqual([]);
  });

  it("rejects an unknown CTA merge field token with a ctaUrl warning", () => {
    const result = normalizeDripStep(step({ ctaUrl: "{{bogus}}" }));

    expect(result.step.ctaLabel).toBeNull();
    expect(result.step.ctaUrl).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("ctaUrl");
    expect(result.warnings[0]).toContain("{{bogus}}");
  });

  it("rejects a wrong-kind merge field token in a CTA URL", () => {
    const result = normalizeDripStep(step({ ctaUrl: "{{first_name}}" }));

    expect(result.step.ctaLabel).toBeNull();
    expect(result.step.ctaUrl).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("ctaUrl");
    expect(result.warnings[0]).toContain("{{first_name}}");
  });

  it("rejects javascript CTA URLs", () => {
    const result = normalizeDripStep(step({ ctaUrl: "javascript:alert(1)" }));

    expect(result.step.ctaLabel).toBeNull();
    expect(result.step.ctaUrl).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("ctaUrl");
    expect(result.warnings[0]).toContain("javascript:alert(1)");
  });

  it("preserves standard CTA URL shapes unchanged", () => {
    const httpsResult = normalizeDripStep(step({ ctaUrl: "https://example.com/x" }));
    const mailtoResult = normalizeDripStep(step({ ctaUrl: `mailto:${brand.email.contact}` }));
    const pathResult = normalizeDripStep(step({ ctaUrl: "/path" }));

    expect(httpsResult.step.ctaUrl).toBe("https://example.com/x");
    expect(mailtoResult.step.ctaUrl).toBe(`mailto:${brand.email.contact}`);
    expect(pathResult.step.ctaUrl).toBe("/path");
    expect(httpsResult.warnings).toEqual([]);
    expect(mailtoResult.warnings).toEqual([]);
    expect(pathResult.warnings).toEqual([]);
  });

  it("collapses CTA halves when either the label or URL is missing", () => {
    const labelOnly = normalizeDripStep(step({ ctaUrl: "" }));
    const urlOnly = normalizeDripStep(step({ ctaLabel: "" }));

    expect(labelOnly.step.ctaLabel).toBeNull();
    expect(labelOnly.step.ctaUrl).toBeNull();
    expect(urlOnly.step.ctaLabel).toBeNull();
    expect(urlOnly.step.ctaUrl).toBeNull();
  });
});

describe("normalizeDripStepSequence", () => {
  it("prefixes warnings with the step number", () => {
    const result = normalizeDripStepSequence([
      step(),
      step({ ctaUrl: "{{bogus}}" }),
    ]);

    expect(result.steps).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("step 2: ");
    expect(result.warnings[0]).toContain("ctaUrl");
  });
});

describe("normalizeDripSettings trigger", () => {
  // Regression: a first pass at BROADCAST support added the allowlist check to
  // the MCP route instead of here, which made `trigger` mandatory on every
  // settings update — undefined has always meant "leave the stored trigger
  // alone", so that silently broke every partial upsert.
  const settings = (trigger?: unknown) => ({
    name: "Campaign",
    description: "",
    ...(trigger === undefined ? {} : { trigger }),
    autoEnroll: false,
    priority: 100,
    timezone: "America/Los_Angeles",
    sendWindowStartHour: 8,
    sendWindowEndHour: 18,
    skipWeekends: false,
    exitOnStatuses: ["WON"],
    testEmail: "",
  });

  it("SC-21: an omitted trigger stays undefined so the stored value is untouched", () => {
    expect(normalizeDripSettings(settings()).trigger).toBeUndefined();
  });

  it("SC-22: BROADCAST is an accepted trigger", () => {
    expect(normalizeDripSettings(settings("BROADCAST")).trigger).toBe("BROADCAST");
  });

  it("SC-23: the two pre-existing triggers still round-trip", () => {
    expect(normalizeDripSettings(settings("LEAD_SEGMENT")).trigger).toBe("LEAD_SEGMENT");
    expect(normalizeDripSettings(settings("COHORT_SCHEDULE")).trigger).toBe("COHORT_SCHEDULE");
  });

  it("SC-24: an unknown trigger is rejected", () => {
    expect(() => normalizeDripSettings(settings("NONSENSE"))).toThrow(/trigger must be one of/);
  });
});
