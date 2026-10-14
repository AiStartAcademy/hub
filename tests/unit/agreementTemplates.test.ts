import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

mock.module("server-only", () => ({}));

const {
  AGREEMENT_TEMPLATE_FILES,
  AGREEMENT_TEMPLATE_KEYS,
  AISA_SIGNER_DEFAULTS,
  SIGNATURE_BLOCK_MARKER,
  TEMPLATE_VARIABLE_SPECS,
  getAgreementTemplate,
  renderTemplate,
} = await import("@/lib/agreementTemplates");

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const RAW_PLACEHOLDER_PATTERN = /{{\s*[a-zA-Z0-9_]+\s*}}/;
const ORGANIZER_MARKER_PATTERN = /\[\[organizer:([a-zA-Z0-9_]+)\]\]/g;

function extractPlaceholderKeysFromTemplate(templateKey: keyof typeof AGREEMENT_TEMPLATE_FILES): string[] {
  const template = readRawTemplate(templateKey);
  const seenKeys = new Set<string>();
  const keys: string[] = [];

  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholderKey = match[1];

    if (seenKeys.has(placeholderKey)) {
      continue;
    }

    seenKeys.add(placeholderKey);
    keys.push(placeholderKey);
  }

  return keys;
}

function readRawTemplate(templateKey: keyof typeof AGREEMENT_TEMPLATE_FILES): string {
  const templatePath = path.join(process.cwd(), AGREEMENT_TEMPLATE_FILES[templateKey]);
  return readFileSync(templatePath, "utf8");
}

describe("TEMPLATE_VARIABLE_SPECS", () => {
  for (const templateKey of AGREEMENT_TEMPLATE_KEYS) {
    it(`matches the exact placeholder set for ${templateKey}`, () => {
      const placeholderKeys = extractPlaceholderKeysFromTemplate(templateKey);
      const specKeys = TEMPLATE_VARIABLE_SPECS[templateKey].map((spec) => spec.key);

      expect(specKeys).toEqual(placeholderKeys);
    });
  }

  it("falls back to a humanized text spec for placeholders without metadata", () => {
    const barterDeliverablesSpec = TEMPLATE_VARIABLE_SPECS["free-barter"].find(
      (spec) => spec.key === "barterDeliverables",
    );

    expect(barterDeliverablesSpec).toEqual({
      key: "barterDeliverables",
      label: "Barter Deliverables",
      kind: "text",
    });
  });
});

describe("renderTemplate", () => {
  it("allows empty input without throwing and removes raw placeholders from every template", () => {
    for (const templateKey of AGREEMENT_TEMPLATE_KEYS) {
      expect(() =>
        renderTemplate(templateKey, {}, { allowMissing: true }),
      ).not.toThrow();

      const rendered = renderTemplate(templateKey, {}, { allowMissing: true });

      expect(rendered).not.toMatch(RAW_PLACEHOLDER_PATTERN);
      expect(rendered.match(new RegExp(SIGNATURE_BLOCK_MARKER.replaceAll("[", "\\[").replaceAll("]", "\\]"), "g"))?.length).toBe(1);
    }
  });

  it("emits organizer markers only for organizer-fillable placeholders", () => {
    const rendered = renderTemplate("paid-rental", {}, { allowMissing: true });
    const organizerKeys = Array.from(
      rendered.matchAll(ORGANIZER_MARKER_PATTERN),
      (match) => match[1],
    );

    expect(organizerKeys).toEqual([
      "signerTitle",
      "expectedAttendees",
      "capacity",
      "contactEmail",
      "contactPhone",
    ]);
    expect(rendered).toContain("____________ (to be completed)");
    expect(rendered).toContain("Upon Receipt");
    expect(rendered).toContain(SIGNATURE_BLOCK_MARKER);
    expect(rendered).not.toContain("[[organizer:feeAmount]]");
    expect(rendered).not.toContain("[[organizer:paymentTerms]]");
  });

  it("keeps academy signer defaults available outside template placeholders", () => {
    expect(AISA_SIGNER_DEFAULTS).toEqual(brand.signer);

    const rendered = renderTemplate("paid-rental", {}, { allowMissing: true });

    expect(rendered).not.toContain(AISA_SIGNER_DEFAULTS.name);
    expect(rendered).not.toContain(AISA_SIGNER_DEFAULTS.title);
  });

  it("strips attorney-only HTML comments when loading templates", () => {
    const rawTemplate = readRawTemplate("paid-rental");
    const loadedTemplate = getAgreementTemplate("paid-rental");

    expect(rawTemplate).toContain("<!-- boilerplate pending attorney review -->");
    expect(loadedTemplate).not.toContain("<!-- boilerplate pending attorney review -->");
    expect(loadedTemplate).toContain("## Electronic Signatures");
  });

  it("throws in strict mode when required values are missing or blank", () => {
    const renderStrictTemplate = () =>
      renderTemplate("paid-rental", {
        orgName: `${brand.shortName} Partner`,
        eventTitle: "Launch Night",
        eventDate: "August 5, 2026",
        startTime: " ",
        endTime: "9:00 PM",
        signerName: "Morgan Lee",
      });

    expect(renderStrictTemplate).toThrow(
      "Missing agreement template variables for paid-rental:",
    );

    try {
      renderStrictTemplate();
      throw new Error("Expected strict render to throw");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      expect(errorMessage).toContain("startTime");
      expect(errorMessage).toContain("signerTitle");
      expect(errorMessage).toContain("feeAmount");
      expect(errorMessage).toContain("depositAmount");
    }
  });

  it("uses provided values instead of spec defaults when both exist", () => {
    const rendered = renderTemplate(
      "paid-rental",
      {
        orgName: `${brand.shortName} Partner`,
        signerName: "Morgan Lee",
        signerTitle: "Founder",
        eventTitle: "Launch Night",
        eventDate: "August 5, 2026",
        startTime: "6:00 PM",
        endTime: "9:00 PM",
        expectedAttendees: "80",
        capacity: "120",
        contactEmail: "events@example.com",
        contactPhone: "555-0101",
        feeAmount: "$500",
        depositAmount: "$250",
        paymentTerms: "NET30",
        insuranceRequirement: "Custom insurance language",
        alcoholPolicy: "Custom alcohol language",
        cancellationTerms: "Custom cancellation language",
      },
      { allowMissing: true },
    );

    expect(rendered).toContain("NET30");
    expect(rendered).toContain("Custom insurance language");
    expect(rendered).toContain("Custom alcohol language");
    expect(rendered).toContain("Custom cancellation language");
    expect(rendered).not.toContain("Upon Receipt");
    expect(rendered).not.toContain(AISA_SIGNER_DEFAULTS.name);
    expect(rendered).not.toContain(AISA_SIGNER_DEFAULTS.title);
  });

  it("drops one trailing period when the template already ends the sentence", () => {
    const rendered = renderTemplate(
      "paid-rental",
      {
        orgName: `${brand.shortName} Partner`,
        signerName: "Morgan Lee",
        signerTitle: "Founder",
        eventTitle: "Launch Night",
        eventDate: "August 5, 2026",
        startTime: "6:00 PM",
        endTime: "9:00 PM",
        expectedAttendees: "80",
        capacity: "120",
        contactEmail: "events@example.com",
        contactPhone: "555-0101",
        feeAmount: "$500",
        depositAmount: "$250",
        paymentTerms: "NET30",
        insuranceRequirement: "Proof available.",
        alcoholPolicy: "Ends at 8:30 PM.",
        cancellationTerms: "Refunded in full.",
      },
      { allowMissing: true },
    );

    expect(rendered).toContain("Proof available**.");
    expect(rendered).toContain("Ends at 8:30 PM**.");
    expect(rendered).toContain("Refunded in full**.");
    expect(rendered).not.toContain("Proof available.**.");
    expect(rendered).not.toContain("Ends at 8:30 PM.**.");
    expect(rendered).not.toContain("Refunded in full.**.");
  });

  it("leaves ellipses and abbreviation-like values untouched", () => {
    const rendered = renderTemplate(
      "paid-rental",
      {
        orgName: `${brand.shortName} Partner`,
        signerName: "Morgan Lee",
        signerTitle: "Founder",
        eventTitle: "Launch Night",
        eventDate: "August 5, 2026",
        startTime: "6:00 PM",
        endTime: "9:00 PM",
        expectedAttendees: "80",
        capacity: "120",
        contactEmail: "events@example.com",
        contactPhone: "555-0101",
        feeAmount: "$500",
        depositAmount: "$250",
        paymentTerms: "NET30",
        insuranceRequirement: "Wait...",
        alcoholPolicy: "Dr.",
        cancellationTerms: "Hold...",
      },
      { allowMissing: true },
    );

    expect(rendered).toContain("Wait...**.");
    expect(rendered).toContain("Dr.**.");
    expect(rendered).toContain("Hold...**.");
  });
});
