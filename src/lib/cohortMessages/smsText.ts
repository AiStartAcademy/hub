import { brand } from "@/config/brand";

export const COHORT_MESSAGE_MERGE_FIELDS = [
  "firstName",
  "cohortName",
  "nextSessionDate",
  "sessionLink",
] as const;

export type CohortMessageMergeField = (typeof COHORT_MESSAGE_MERGE_FIELDS)[number];

export type CohortMessageMergeValues = Record<CohortMessageMergeField, string>;

const COHORT_MESSAGE_MERGE_FIELD_SET = new Set<string>(COHORT_MESSAGE_MERGE_FIELDS);
const COHORT_MESSAGE_MERGE_PATTERN = /\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}/g;

/**
 * Replaces supported cohort-message tokens without interpreting any other
 * staff-authored braces. Escaping belongs to values, not to the template.
 */
export function renderCohortMessageText(
  template: string,
  values: Partial<Record<CohortMessageMergeField, string | null | undefined>>,
  options?: { escape?: (value: string) => string }
): string {
  return template.replace(COHORT_MESSAGE_MERGE_PATTERN, (token, field: string) => {
    if (!COHORT_MESSAGE_MERGE_FIELD_SET.has(field)) return token;
    const value = values[field as CohortMessageMergeField];
    if (value == null) return "";
    return options?.escape ? options.escape(value) : value;
  });
}

/** First whitespace-delimited name token, excluding capture placeholders. */
export function mergeFirstName(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0] ?? "";
  if (!first || /^(lead|guest)$/i.test(first)) return "";
  return first;
}

export const COHORT_SMS_PREFIX = brand.smsSenderPrefix;
export const COHORT_SMS_SUFFIX = " Reply STOP to opt out.";
export const COHORT_SMS_MAX_GSM7 = 320;

/** GSM 03.38 default alphabet, excluding ESC (which is not printable text). */
const GSM7_BASIC_CHARS = new Set(
  [
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ",
    " !\"#¤%&'()*+,-./0123456789:;<=>?¡",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿",
    "abcdefghijklmnopqrstuvwxyzäöñüà",
  ].join("")
);

/** Characters encoded through the GSM 03.38 extension table. */
const GSM7_EXTENSION_CHARS = new Set("^{}\\[~]|€\f");

/** Normalize common rich-text punctuation into GSM-safe equivalents. */
export function normalizeSmsText(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Count GSM septets and report unsupported code points in first-seen order. */
export function smsLength(text: string): { septets: number; nonGsmChars: string[] } {
  let septets = 0;
  const nonGsmChars: string[] = [];
  const seenNonGsm = new Set<string>();

  for (const character of text) {
    if (GSM7_BASIC_CHARS.has(character)) {
      septets += 1;
    } else if (GSM7_EXTENSION_CHARS.has(character)) {
      septets += 2;
    } else if (!seenNonGsm.has(character)) {
      seenNonGsm.add(character);
      nonGsmChars.push(character);
    }
  }

  return { septets, nonGsmChars };
}

/** Render the exact full text handed to the SMS provider. */
export function renderCohortMessageSms(
  body: string,
  values: Partial<Record<CohortMessageMergeField, string | null | undefined>>
): string {
  const renderedBody = renderCohortMessageText(body, values);
  return normalizeSmsText(COHORT_SMS_PREFIX + renderedBody + COHORT_SMS_SUFFIX);
}

export type CohortSmsValidation =
  | { ok: true; text: string; septets: number }
  | { ok: false; error: string; septets: number };

/** Validate a cohort SMS using the complete branded, merged, normalized text. */
export function validateCohortMessageSms(
  body: string,
  values: Partial<Record<CohortMessageMergeField, string | null | undefined>>
): CohortSmsValidation {
  const renderedBody = normalizeSmsText(renderCohortMessageText(body, values));
  if (!renderedBody) {
    return { ok: false, error: "SMS body is empty", septets: 0 };
  }

  const text = renderCohortMessageSms(body, values);
  const { septets, nonGsmChars } = smsLength(text);

  if (nonGsmChars.length > 0) {
    return {
      ok: false,
      error: `SMS contains characters outside GSM-7: ${nonGsmChars.join(" ")}`,
      septets,
    };
  }

  if (septets > COHORT_SMS_MAX_GSM7) {
    return {
      ok: false,
      error: `SMS exceeds the ${COHORT_SMS_MAX_GSM7} GSM-7 character limit`,
      septets,
    };
  }

  return { ok: true, text, septets };
}

function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HTTP_URL_PATTERN = /(^|[^A-Za-z0-9+.\-:])(https?:\/\/[^\s<>"']+)/gi;
const TRAILING_URL_PUNCTUATION = /[.,)!?;:]+$/;

function autolinkAndEscape(value: string): string {
  let output = "";
  let previousEnd = 0;

  for (const match of value.matchAll(HTTP_URL_PATTERN)) {
    const start = match.index + match[1].length;
    const matchedUrl = match[2];
    const url = matchedUrl.replace(TRAILING_URL_PUNCTUATION, "");
    const punctuation = matchedUrl.slice(url.length);

    output += escapeEmailHtml(value.slice(previousEnd, start));
    if (url) {
      const escapedUrl = escapeEmailHtml(url);
      output += `<a href="${escapedUrl}">${escapedUrl}</a>`;
    }
    output += escapeEmailHtml(punctuation);
    previousEnd = start + matchedUrl.length;
  }

  return output + escapeEmailHtml(value.slice(previousEnd));
}

/** Convert composer plain text into safe, minimal email HTML. */
export function plainTextToEmailHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return "";

  return lines
    .join("\n")
    .split(/\n[ \t]*\n(?:[ \t]*\n)*/)
    .map((paragraph) => `<p>${autolinkAndEscape(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
