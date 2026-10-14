// src/lib/phone.ts
//
// Phone helpers shared by the onboarding quiz phone field and the voice-call
// features (drip CALL channel, "Call with AI" button). Browser-safe — no
// Prisma or Node-core imports, so client components may import it.
//
// Contact.phone is historically free-text; everything that dials MUST go
// through normalizePhoneE164() and treat a null as "not callable".

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { brand } from "@/config/brand";

export type CountryDialCode = {
  isoCode: string;
  countryName: string;
  dialCode: string;
};

export const DEFAULT_DIAL_CODE = "+1";

export const COUNTRY_DIAL_CODES: CountryDialCode[] = [
  { isoCode: "US", countryName: "United States", dialCode: "+1" },
  { isoCode: "CA", countryName: "Canada", dialCode: "+1" },
  { isoCode: "GB", countryName: "United Kingdom", dialCode: "+44" },
  { isoCode: "AU", countryName: "Australia", dialCode: "+61" },
  { isoCode: "DE", countryName: "Germany", dialCode: "+49" },
  { isoCode: "FR", countryName: "France", dialCode: "+33" },
  { isoCode: "IN", countryName: "India", dialCode: "+91" },
  { isoCode: "MX", countryName: "Mexico", dialCode: "+52" },
  { isoCode: "BR", countryName: "Brazil", dialCode: "+55" },
  { isoCode: "ES", countryName: "Spain", dialCode: "+34" },
  { isoCode: "IT", countryName: "Italy", dialCode: "+39" },
  { isoCode: "NL", countryName: "Netherlands", dialCode: "+31" },
  { isoCode: "IE", countryName: "Ireland", dialCode: "+353" },
  { isoCode: "NZ", countryName: "New Zealand", dialCode: "+64" },
  { isoCode: "SG", countryName: "Singapore", dialCode: "+65" },
  { isoCode: "AE", countryName: "United Arab Emirates", dialCode: "+971" },
  { isoCode: "ZA", countryName: "South Africa", dialCode: "+27" },
  { isoCode: "NG", countryName: "Nigeria", dialCode: "+234" },
  { isoCode: "KE", countryName: "Kenya", dialCode: "+254" },
  { isoCode: "JP", countryName: "Japan", dialCode: "+81" },
  { isoCode: "CN", countryName: "China", dialCode: "+86" },
  { isoCode: "KR", countryName: "South Korea", dialCode: "+82" },
  { isoCode: "HK", countryName: "Hong Kong", dialCode: "+852" },
  { isoCode: "SE", countryName: "Sweden", dialCode: "+46" },
  { isoCode: "NO", countryName: "Norway", dialCode: "+47" },
  { isoCode: "DK", countryName: "Denmark", dialCode: "+45" },
  { isoCode: "FI", countryName: "Finland", dialCode: "+358" },
  { isoCode: "CH", countryName: "Switzerland", dialCode: "+41" },
  { isoCode: "AT", countryName: "Austria", dialCode: "+43" },
  { isoCode: "BE", countryName: "Belgium", dialCode: "+32" },
  { isoCode: "PT", countryName: "Portugal", dialCode: "+351" },
  { isoCode: "PL", countryName: "Poland", dialCode: "+48" },
  { isoCode: "CZ", countryName: "Czech Republic", dialCode: "+420" },
  { isoCode: "GR", countryName: "Greece", dialCode: "+30" },
  { isoCode: "TR", countryName: "Turkey", dialCode: "+90" },
  { isoCode: "IL", countryName: "Israel", dialCode: "+972" },
  { isoCode: "SA", countryName: "Saudi Arabia", dialCode: "+966" },
  { isoCode: "PK", countryName: "Pakistan", dialCode: "+92" },
  { isoCode: "ID", countryName: "Indonesia", dialCode: "+62" },
  { isoCode: "MY", countryName: "Malaysia", dialCode: "+60" },
  { isoCode: "PH", countryName: "Philippines", dialCode: "+63" },
  { isoCode: "TH", countryName: "Thailand", dialCode: "+66" },
  { isoCode: "VN", countryName: "Vietnam", dialCode: "+84" },
  { isoCode: "AR", countryName: "Argentina", dialCode: "+54" },
  { isoCode: "CL", countryName: "Chile", dialCode: "+56" },
  { isoCode: "CO", countryName: "Colombia", dialCode: "+57" },
  { isoCode: "PE", countryName: "Peru", dialCode: "+51" },
];

const KNOWN_DIAL_CODES = [...new Set(COUNTRY_DIAL_CODES.map((entry) => entry.dialCode))].sort(
  (left, right) => right.length - left.length
);

function normalizeDialCode(value: string): string {
  return KNOWN_DIAL_CODES.includes(value) ? value : DEFAULT_DIAL_CODE;
}

function normalizeNationalNumber(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function joinStoredPhoneValue(dialCode: string, nationalNumber: string): string {
  const normalizedNumber = normalizeNationalNumber(nationalNumber);
  if (!normalizedNumber) return "";
  return `${normalizeDialCode(dialCode)} ${normalizedNumber}`;
}

export function stripDuplicateDialCode(dialCode: string, nationalNumber: string): string {
  const normalizedNumber = normalizeNationalNumber(nationalNumber);
  if (!normalizedNumber) return "";

  const dialCodeDigits = normalizeDialCode(dialCode).replace(/\D/g, "");
  const numberDigits = normalizedNumber.replace(/\D/g, "");
  if (!numberDigits.startsWith(dialCodeDigits)) return normalizedNumber;

  const withoutDialCode = numberDigits.slice(dialCodeDigits.length);
  if (normalizedNumber.startsWith("+")) return withoutDialCode;

  const asEntered = normalizePhoneE164(`${dialCode} ${numberDigits}`);
  const deduplicated = normalizePhoneE164(`${dialCode} ${withoutDialCode}`);
  return !asEntered && deduplicated ? withoutDialCode : normalizedNumber;
}

export function dedupeStoredPhoneValue(value: string): string {
  const { dialCode, nationalNumber } = splitStoredPhoneValue(value);
  const collapsed = value.trim().replace(/\s+/g, " ");
  const enteredNumber = collapsed.startsWith(dialCode)
    ? collapsed.slice(dialCode.length).trim()
    : nationalNumber;
  return joinStoredPhoneValue(
    dialCode,
    stripDuplicateDialCode(dialCode, enteredNumber)
  );
}

export function splitStoredPhoneValue(value: unknown): {
  dialCode: string;
  nationalNumber: string;
} {
  if (typeof value !== "string") {
    return { dialCode: DEFAULT_DIAL_CODE, nationalNumber: "" };
  }

  const collapsed = value.trim().replace(/\s+/g, " ");
  if (!collapsed) {
    return { dialCode: DEFAULT_DIAL_CODE, nationalNumber: "" };
  }

  const compact = collapsed.replace(/[^\d+]/g, "");
  const matchedDialCode = KNOWN_DIAL_CODES.find((dialCode) => compact.startsWith(dialCode));

  if (matchedDialCode) {
    return {
      dialCode: matchedDialCode,
      nationalNumber: compact.slice(matchedDialCode.length).replace(/\D/g, ""),
    };
  }

  const [dialCodeToken, ...restTokens] = collapsed.split(" ");
  if (/^\+\d{1,4}$/.test(dialCodeToken)) {
    return {
      dialCode: dialCodeToken,
      nationalNumber: restTokens.join("").replace(/\D/g, ""),
    };
  }

  return {
    dialCode: DEFAULT_DIAL_CODE,
    nationalNumber: collapsed.replace(/\D/g, ""),
  };
}

// ── Voice-call helpers ────────────────────────────────────────────────

/** Region assumed when the number has no country code. Leads are US-first. */
const DEFAULT_REGION = "US";

/**
 * Normalize arbitrary user-entered phone text to strict E.164 ("+14155551234").
 * Returns null when the input isn't a valid, dialable number.
 */
export function normalizePhoneE164(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw, DEFAULT_REGION);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Keep loosely valid input visible to staff when strict E.164 parsing fails. */
export function onboardingPhoneForStorage(value: string | null): string | null {
  return normalizePhoneE164(value) ?? value;
}

/**
 * Public-form typos must never clobber a CRM number that staff already trust.
 * Whitespace-only stored values are empty and may be filled by the incoming value.
 */
export function fillPhoneIfEmpty(
  existingPhone: string | null,
  incomingPhone: string | null
): string | null {
  return existingPhone === null || existingPhone.trim() === ""
    ? incomingPhone
    : existingPhone;
}

export type CallableContact = {
  phone: string | null;
  phoneConsentAt: Date | string | null;
  doNotCall: boolean;
};

/**
 * Why a contact can't receive an automated call, or null if they can.
 * Human-dialed calls are NOT gated by this — it exists for machines.
 */
export function callabilityReason(contact: CallableContact): string | null {
  if (contact.doNotCall) return "do_not_call";
  if (!contact.phoneConsentAt) return "no_call_consent";
  if (!normalizePhoneE164(contact.phone)) return "invalid_phone";
  return null;
}

export function isCallable(contact: CallableContact): boolean {
  return callabilityReason(contact) === null;
}

export type SmsPurpose = "marketing" | "transactional" | "any";

export type SmsabilityReason =
  | "sms_opt_out"
  | "no_sms_marketing_consent"
  | "no_sms_transactional_consent"
  | "no_sms_consent"
  | "invalid_phone";

/**
 * Why a contact can't receive SMS, or null if they can.
 * SMS-specific: phone consent is shared with calls, while SMS has its own opt-out.
 */
export function smsableReason(contact: {
  phone: string | null;
  smsMarketingConsentAt: Date | string | null;
  smsTransactionalConsentAt: Date | string | null;
  smsOptOutAt: Date | null;
}, purpose: SmsPurpose): SmsabilityReason | null {
  if (contact.smsOptOutAt) return "sms_opt_out";
  if (purpose === "marketing" && !contact.smsMarketingConsentAt) {
    return "no_sms_marketing_consent";
  }
  if (purpose === "transactional" && !contact.smsTransactionalConsentAt) {
    return "no_sms_transactional_consent";
  }
  if (
    purpose === "any" &&
    !contact.smsMarketingConsentAt &&
    !contact.smsTransactionalConsentAt
  ) {
    return "no_sms_consent";
  }
  if (!normalizePhoneE164(contact.phone)) return "invalid_phone";
  return null;
}

export const SMS_MARKETING_CONSENT_DISCLOSURE =
  `I agree to receive marketing text messages from ${brand.wordmark}, such as course and bootcamp follow-ups, offers, and new cohort announcements. Message frequency varies (up to 4 msgs/month). Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of any purchase.`;

export const SMS_TRANSACTIONAL_CONSENT_DISCLOSURE =
  `I agree to receive non-marketing text messages from ${brand.wordmark}, such as reminders about my cohort start dates and class sessions. Message frequency varies (up to 10 msgs/month). Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;

export const CALL_CONSENT_DISCLOSURE =
  `I agree to receive phone calls from ${brand.wordmark} about my request, including calls placed by an automated/AI assistant.`;

export const SMS_OPT_IN_CONFIRMATION =
  `${brand.smsSenderPrefix}You're subscribed to text updates. Up to 10 msgs/month. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;

export const TERMS_OF_SERVICE_URL = brand.urls.termsOfService;
export const PRIVACY_POLICY_URL = brand.urls.privacyPolicy;
