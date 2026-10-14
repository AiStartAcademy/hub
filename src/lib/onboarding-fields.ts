import { sanitizePlainText } from "@/lib/onboarding-security";

export type OnboardingFieldMapping = {
  firstName?: string;
  lastName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
};

export type FieldElement = {
  id: string;
  label: string;
  type: string;
};

const LABEL_ALIASES: Record<keyof OnboardingFieldMapping, string[]> = {
  firstName: ["firstname", "givenname"],
  lastName: ["lastname", "surname", "familyname"],
  contactName: ["name", "fullname", "contactname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "telephone"],
  email: ["email", "emailaddress", "workemail"],
};

function normalizeLabel(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ELIGIBLE_TYPES: Record<keyof OnboardingFieldMapping, string[]> = {
  firstName: ["text_single", "text_multi"],
  lastName: ["text_single", "text_multi"],
  contactName: ["text_single", "text_multi"],
  phone: ["text_single", "text_multi", "phone"],
  email: ["text_single", "text_multi"],
};

export function parseFieldMapping(raw: unknown): OnboardingFieldMapping {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const mapping: OnboardingFieldMapping = {};
    for (const key of Object.keys(LABEL_ALIASES) as Array<keyof OnboardingFieldMapping>) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value) mapping[key] = value;
    }
    return mapping;
  } catch {
    return {};
  }
}

export function resolveFieldMapping(
  elements: FieldElement[],
  configured: OnboardingFieldMapping
): OnboardingFieldMapping {
  const mapping: OnboardingFieldMapping = {};

  for (const key of Object.keys(LABEL_ALIASES) as Array<keyof OnboardingFieldMapping>) {
    const eligibleElements = elements.filter((element) =>
      ELIGIBLE_TYPES[key].includes(element.type)
    );
    const validIds = new Set(eligibleElements.map((element) => element.id));
    const configuredId = configured[key];
    if (configuredId && validIds.has(configuredId)) {
      mapping[key] = configuredId;
      continue;
    }
    const inferred = eligibleElements.find((element) =>
      LABEL_ALIASES[key].includes(normalizeLabel(element.label))
    );
    if (inferred) {
      mapping[key] = inferred.id;
      continue;
    }
    if (key === "phone") {
      const fallbackPhoneElement = elements.find((element) => element.type === "phone");
      if (fallbackPhoneElement) mapping.phone = fallbackPhoneElement.id;
    }
  }

  return mapping;
}

export function mappedTextAnswer(
  answers: Record<string, string | string[]>,
  elementId: string | undefined,
  maxLength: number
): string {
  if (!elementId) return "";
  const value = answers[elementId];
  return typeof value === "string" ? sanitizePlainText(value, maxLength) : "";
}
