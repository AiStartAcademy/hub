import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { brand } from "@/config/brand";
import { renderBrandTokens } from "@/lib/brandTokens";

export const AGREEMENT_TEMPLATE_KEYS = [
  "paid-rental",
  "free-barter",
  "revenue-share",
] as const;

export type AgreementTemplateKey = (typeof AGREEMENT_TEMPLATE_KEYS)[number];

export type AgreementTemplateVariables = Record<string, string | number>;

export type AgreementVariableKind = "text" | "money" | "select" | "textarea";

export interface AgreementVariableSpec {
  key: string;
  label: string;
  kind: AgreementVariableKind;
  options?: readonly string[];
  defaultValue?: string;
  organizerFillable?: boolean;
}

export const AGREEMENT_TEMPLATE_FILES: Record<AgreementTemplateKey, string> = {
  "paid-rental": "src/content/agreements/paid-rental.md",
  "free-barter": "src/content/agreements/free-barter.md",
  "revenue-share": "src/content/agreements/revenue-share.md",
};

export const SIGNATURE_BLOCK_MARKER = "[[signature-block]]";

export const AISA_SIGNER_DEFAULTS = {
  name: brand.signer.name,
  title: brand.signer.title,
} as const;

const PLACEHOLDER_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const VISIBLE_BLANK_VALUE = "____________ (to be completed)";

type AgreementVariableMetadata = Omit<AgreementVariableSpec, "key">;

const VARIABLE_METADATA_BY_KEY: Readonly<Record<string, AgreementVariableMetadata>> = {
  feeAmount: {
    kind: "money",
    label: "Rental fee",
  },
  depositAmount: {
    kind: "money",
    label: "Deposit",
  },
  paymentTerms: {
    kind: "select",
    label: "Payment terms",
    options: ["Upon Receipt", "NET5", "NET15", "NET30"],
    defaultValue: "Upon Receipt",
  },
  insuranceRequirement: {
    kind: "textarea",
    label: "Insurance requirement",
    defaultValue: `${brand.shortName} carries General Liability insurance. Proof of insurance: ${brand.urls.insuranceCertificate}`,
  },
  alcoholPolicy: {
    kind: "textarea",
    label: "Alcohol policy",
    defaultValue: `No alcohol may be served or sold unless agreed with ${brand.shortName} in writing in advance. If alcohol is served: guests must be 21+, service must be by the Organizer or a licensed/insured caterer, service ends at least 30 minutes before the event ends, and the Organizer is solely responsible for compliance with ${brand.address.regionName} ABC rules and for guest conduct.`,
  },
  cancellationTerms: {
    kind: "textarea",
    label: "Cancellation terms",
    defaultValue: `Cancellation by Organizer: 7+ days before the event — full refund of amounts paid; 3–6 days — 50% refund; less than 72 hours — no refund. If ${brand.shortName} must cancel, all amounts paid are refunded in full.`,
  },
  signerTitle: {
    kind: "text",
    label: "Signer title",
    organizerFillable: true,
  },
  expectedAttendees: {
    kind: "text",
    label: "Expected attendees",
    organizerFillable: true,
  },
  capacity: {
    kind: "text",
    label: "Attendance cap",
    organizerFillable: true,
  },
  contactEmail: {
    kind: "text",
    label: "Contact email",
    organizerFillable: true,
  },
  contactPhone: {
    kind: "text",
    label: "Contact phone",
    organizerFillable: true,
  },
  orgName: {
    kind: "text",
    label: "Organization name",
  },
  eventTitle: {
    kind: "text",
    label: "Event title",
  },
  eventDate: {
    kind: "text",
    label: "Event date",
  },
  startTime: {
    kind: "text",
    label: "Start time",
  },
  endTime: {
    kind: "text",
    label: "End time",
  },
  signerName: {
    kind: "text",
    label: "Signer name",
  },
};

const TEMPLATE_CONTENT_BY_KEY: Record<AgreementTemplateKey, string> = {
  "paid-rental": readTemplateFile("paid-rental"),
  "free-barter": readTemplateFile("free-barter"),
  "revenue-share": readTemplateFile("revenue-share"),
};

export const TEMPLATE_VARIABLE_SPECS: Record<
  AgreementTemplateKey,
  readonly AgreementVariableSpec[]
> = buildTemplateVariableSpecs();

function readTemplateFile(key: AgreementTemplateKey): string {
  // Agreement preview escapes HTML before rendering, so attorney-only HTML
  // comments must be stripped here instead of leaking into the visible output.
  const raw = readFileSync(path.join(process.cwd(), AGREEMENT_TEMPLATE_FILES[key]), "utf8");
  return renderBrandTokens(raw, AGREEMENT_TEMPLATE_FILES[key]).replace(HTML_COMMENT_PATTERN, "");
}

function buildTemplateVariableSpecs(): Record<
  AgreementTemplateKey,
  readonly AgreementVariableSpec[]
> {
  const specsByTemplate = {} as Record<AgreementTemplateKey, readonly AgreementVariableSpec[]>;

  for (const key of AGREEMENT_TEMPLATE_KEYS) {
    const placeholderKeys = extractPlaceholderKeys(TEMPLATE_CONTENT_BY_KEY[key]);
    specsByTemplate[key] = Object.freeze(
      placeholderKeys.map((placeholderKey) => buildVariableSpec(placeholderKey)),
    );
  }

  return Object.freeze(specsByTemplate);
}

function buildVariableSpec(key: string): AgreementVariableSpec {
  const metadata = VARIABLE_METADATA_BY_KEY[key];

  if (!metadata) {
    return {
      key,
      label: humanizeVariableKey(key),
      kind: "text",
    };
  }

  if (metadata.kind === "select") {
    if (!metadata.options || metadata.options.length === 0) {
      throw new Error(
        `Agreement variable metadata for ${key} must define options for kind "select"`,
      );
    }

    return {
      key,
      label: metadata.label,
      kind: metadata.kind,
      options: Object.freeze([...metadata.options]),
      defaultValue: metadata.defaultValue,
      organizerFillable: metadata.organizerFillable,
    };
  }

  if (metadata.options !== undefined) {
    throw new Error(
      `Agreement variable metadata for ${key} must not define options unless kind is "select"`,
    );
  }

  return {
    key,
    label: metadata.label,
    kind: metadata.kind,
    defaultValue: metadata.defaultValue,
    organizerFillable: metadata.organizerFillable,
  };
}

function extractPlaceholderKeys(template: string): string[] {
  const keys: string[] = [];
  const seenKeys = new Set<string>();

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

function humanizeVariableKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isMissingValue(value: string | number | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  return false;
}

function resolvePlaceholderValue(
  spec: AgreementVariableSpec,
  variables: AgreementTemplateVariables,
  allowMissing: boolean,
): string | undefined {
  const explicitValue = variables[spec.key];

  if (!isMissingValue(explicitValue)) {
    return String(explicitValue);
  }

  if (spec.defaultValue !== undefined) {
    return spec.defaultValue;
  }

  if (!allowMissing) {
    return undefined;
  }

  if (spec.organizerFillable) {
    return `[[organizer:${spec.key}]]`;
  }

  return VISIBLE_BLANK_VALUE;
}

function nextTemplatePunctuation(template: string, placeholderEndIndex: number): string | undefined {
  const trailingFormatting = template.slice(placeholderEndIndex).match(/^[*_`\s]*/u);
  const nextIndex = placeholderEndIndex + (trailingFormatting?.[0].length ?? 0);
  return template.at(nextIndex);
}

function trimTrailingPeriodBeforeTemplatePeriod(
  value: string,
  template: string,
  placeholderEndIndex: number,
): string {
  const trimmedValue = value.trimEnd();
  const nextCharacter = nextTemplatePunctuation(template, placeholderEndIndex);

  if (nextCharacter !== ".") {
    return value;
  }

  // Only trim one sentence-ending period when the template already contributes
  // the final period after placeholder-adjacent markdown. Leave ellipses and
  // short abbreviation-like values such as `Dr.` untouched.
  if (!/\s/u.test(trimmedValue) || !/[^.]\.$/u.test(trimmedValue)) {
    return value;
  }

  return `${trimmedValue.slice(0, -1)}${value.slice(trimmedValue.length)}`;
}

const ORGANIZER_MARKER_PATTERN = /\[\[organizer:([a-zA-Z0-9_]+)\]\]/g;

export interface OrganizerFillableField {
  key: string;
  label: string;
}

/**
 * Finds `[[organizer:key]]` markers left in a rendered (allowMissing) agreement
 * and returns them with a human label, so the signing page can collect them.
 */
export function extractOrganizerFields(contentMd: string): OrganizerFillableField[] {
  const seenKeys = new Set<string>();
  const fields: OrganizerFillableField[] = [];

  for (const match of contentMd.matchAll(ORGANIZER_MARKER_PATTERN)) {
    const key = match[1];
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    fields.push({ key, label: getVariableLabel(key) });
  }

  return fields;
}

export function getVariableLabel(key: string): string {
  return VARIABLE_METADATA_BY_KEY[key]?.label ?? humanizeVariableKey(key);
}

/**
 * Substitutes signer-supplied values into `[[organizer:key]]` markers left by
 * an allowMissing render. Any key present in `values` but not an actual
 * marker in contentMd is ignored — callers pass exactly the keys extracted by
 * extractOrganizerFields, so this is a safety net, not the validation layer.
 */
export function applyOrganizerFieldValues(
  contentMd: string,
  values: Record<string, string>,
): string {
  return contentMd.replace(ORGANIZER_MARKER_PATTERN, (fullMatch, key: string) => {
    const value = values[key];
    return value && value.trim().length > 0 ? value.trim() : fullMatch;
  });
}

export function templateKeyForDealType(dealType: string): AgreementTemplateKey {
  switch (dealType) {
    case "PAID_RENTAL":
      return "paid-rental";
    case "BARTER":
    case "FREE_PROMO":
      return "free-barter";
    case "REVENUE_SHARE":
      return "revenue-share";
    case "INTERNAL":
      throw new Error("INTERNAL venue events do not have an agreement template");
    default:
      throw new Error(`Unsupported venue event deal type: ${dealType}`);
  }
}

export function getAgreementTemplate(key: AgreementTemplateKey): string {
  return TEMPLATE_CONTENT_BY_KEY[key];
}

export function renderTemplate(
  key: AgreementTemplateKey,
  variables: AgreementTemplateVariables,
  options?: { allowMissing?: boolean },
): string {
  const template = getAgreementTemplate(key);
  const allowMissing = options?.allowMissing === true;
  const specs = TEMPLATE_VARIABLE_SPECS[key];
  const resolvedValues = new Map<string, string>();
  const missingKeys: string[] = [];

  for (const spec of specs) {
    const resolvedValue = resolvePlaceholderValue(spec, variables, allowMissing);

    if (resolvedValue === undefined) {
      missingKeys.push(spec.key);
      continue;
    }

    resolvedValues.set(spec.key, resolvedValue);
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing agreement template variables for ${key}: ${missingKeys.join(", ")}`,
    );
  }

  const rendered = template.replace(
    PLACEHOLDER_PATTERN,
    (match, variableName: string, offset: number) => {
      const resolvedValue = resolvedValues.get(variableName);

      if (resolvedValue !== undefined) {
        const replacementEndIndex = offset + match.length;
        return trimTrailingPeriodBeforeTemplatePeriod(
          resolvedValue,
          template,
          replacementEndIndex,
        );
      }

      throw new Error(`Missing agreement template variable: ${variableName}`);
    },
  );

  if (allowMissing) {
    return rendered;
  }

  const unfilledKeys = extractPlaceholderKeys(rendered);

  if (unfilledKeys.length > 0) {
    throw new Error(
      `Unfilled agreement template variables for ${key}: ${unfilledKeys.join(", ")}`,
    );
  }

  return rendered;
}
