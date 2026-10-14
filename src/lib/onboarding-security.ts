import sanitizeHtml from "sanitize-html";
import { brand } from "@/config/brand";

export const ONBOARDING_ELEMENT_TYPES = [
  "single_choice",
  "multiple_choice",
  "text_single",
  "text_multi",
  "phone",
] as const;

export type OnboardingElementType = (typeof ONBOARDING_ELEMENT_TYPES)[number];
export type OnboardingAnswer = string | string[];

type ElementDefinition = {
  id: string;
  type: string;
  required: boolean;
  options: Array<{ id: string }>;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const HAS_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_REQUEST_BYTES = 64 * 1024;

export function sanitizePlainText(
  value: unknown,
  maxLength: number,
  options: { multiline?: boolean } = {}
): string {
  if (typeof value !== "string") return "";

  const withoutMarkup = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/g, "\n");

  const normalized = options.multiline
    ? withoutMarkup
        .split("\n")
        .map((line) => line.replace(/[\t ]+/g, " ").trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : withoutMarkup.replace(/\s+/g, " ").trim();

  return normalized.slice(0, maxLength);
}

export function normalizeEmail(value: unknown): string | null {
  const email = sanitizePlainText(value, 320).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizePhone(value: unknown): string | null {
  const phone = sanitizePlainText(value, 50);
  if (!phone) return null;
  return /^[+()\d\s.-]{5,50}$/.test(phone) ? phone : null;
}

export function normalizeE164Phone(value: unknown): string | null {
  const phone = sanitizePlainText(value, 32);
  if (!phone) return null;
  if (!phone.startsWith("+")) return null;
  if (!/^[+()\d\s.-]{5,32}$/.test(phone)) return null;

  const digitCount = phone.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15 ? phone : null;
}

export function normalizeSlug(value: unknown): string {
  const slug = sanitizePlainText(value, 100).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Slug must use lowercase letters, numbers, and single hyphens.");
  }
  return slug;
}

export function normalizeRedirectUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Redirect URL must be a string.");

  const url = value.trim();
  if (!url) return null;
  if (url.length > 2048 || HAS_CONTROL_CHARACTERS.test(url) || url.includes("\\")) {
    throw new Error("Redirect URL is invalid or too long.");
  }

  if (url.startsWith("/") && !url.startsWith("//")) {
    const parsed = new URL(url, brand.urls.hub);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  try {
    const parsed = new URL(url);
    const localHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) throw new Error();
    if (parsed.username || parsed.password) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(
      "Redirect URLs must be an https:// link or an internal path beginning with /."
    );
  }
}

export function safeRedirectUrl(value: unknown): string | null {
  try {
    return normalizeRedirectUrl(value);
  } catch {
    return null;
  }
}

export function parseAndValidateAnswers(
  rawBody: string,
  elements: ElementDefinition[]
): { answers: Record<string, OnboardingAnswer> } | { error: string; status: number } {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return { error: "Request is too large.", status: 413 };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { error: "Request body must be valid JSON.", status: 400 };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid request body.", status: 400 };
  }

  const rawAnswers = (body as { answers?: unknown }).answers;
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
    return { error: "Answers must be an object.", status: 400 };
  }

  const definitions = new Map(elements.map((element) => [element.id, element]));
  const answers: Record<string, OnboardingAnswer> = {};

  for (const [elementId, rawAnswer] of Object.entries(rawAnswers)) {
    const element = definitions.get(elementId);
    if (!element) return { error: "Answers contain an unknown field.", status: 400 };

    const validOptionIds = new Set(element.options.map((option) => option.id));
    if (element.type === "single_choice") {
      if (typeof rawAnswer !== "string" || !validOptionIds.has(rawAnswer)) {
        return { error: "A selected answer is invalid.", status: 400 };
      }
      answers[elementId] = rawAnswer;
      continue;
    }

    if (element.type === "multiple_choice") {
      if (
        !Array.isArray(rawAnswer) ||
        rawAnswer.length > element.options.length ||
        rawAnswer.some((value) => typeof value !== "string" || !validOptionIds.has(value))
      ) {
        return { error: "A selected answer is invalid.", status: 400 };
      }
      answers[elementId] = [...new Set(rawAnswer as string[])];
      continue;
    }

    if (element.type === "text_single" || element.type === "text_multi") {
      if (typeof rawAnswer !== "string") {
        return { error: "A text answer is invalid.", status: 400 };
      }
      const maxLength = element.type === "text_multi" ? 5000 : 500;
      if (rawAnswer.length > maxLength * 2) {
        return { error: "A text answer is too long.", status: 400 };
      }
      answers[elementId] = sanitizePlainText(rawAnswer, maxLength, {
        multiline: element.type === "text_multi",
      });
      continue;
    }

    if (element.type === "phone") {
      if (typeof rawAnswer !== "string") {
        return { error: "A phone answer is invalid.", status: 400 };
      }
      if (rawAnswer.length > 64) {
        return { error: "A phone answer is too long.", status: 400 };
      }
      if (rawAnswer === "") {
        answers[elementId] = "";
        continue;
      }
      const phone = normalizeE164Phone(rawAnswer);
      if (!phone) {
        return { error: "Please enter a valid phone number.", status: 400 };
      }
      answers[elementId] = phone;
      continue;
    }

    return { error: "Unsupported onboarding field type.", status: 400 };
  }

  for (const element of elements) {
    if (!element.required || element.type === "phone") continue;
    const answer = answers[element.id];
    if (
      answer === undefined ||
      answer === "" ||
      (Array.isArray(answer) && answer.length === 0)
    ) {
      return { error: "Please complete every required field.", status: 400 };
    }
  }

  return { answers };
}
