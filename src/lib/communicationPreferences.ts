import { brand } from "@/config/brand";
import { normalizePhoneE164 } from "@/lib/phone";

export type CommunicationPreferenceKey =
  | "marketingEmail"
  | "courseEmail"
  | "marketingSms"
  | "courseSms";

export type CommunicationPreferences = Record<CommunicationPreferenceKey, boolean>;

type CommunicationPreferenceContact = {
  unsubscribedAt?: Date | string | null;
  courseEmailOptOutAt?: Date | string | null;
  smsMarketingConsentAt?: Date | string | null;
  smsTransactionalConsentAt?: Date | string | null;
};

export const COMMUNICATION_PREFERENCE_COPY: Record<
  CommunicationPreferenceKey,
  { label: string; description: string }
> = {
  marketingEmail: {
    label: "Marketing emails",
    description: `News, offers, and updates from ${brand.name}.`,
  },
  courseEmail: {
    label: "Course update emails",
    description: "Schedule changes and reminders for cohorts you're enrolled in.",
  },
  marketingSms: {
    label: "Marketing texts",
    description: "News, offers, and updates by text message.",
  },
  courseSms: {
    label: "Course update texts",
    description: "Schedule changes and reminders by text message.",
  },
};

export function communicationPreferencesFromContact(
  contact: CommunicationPreferenceContact | null
): CommunicationPreferences {
  return {
    marketingEmail: contact?.unsubscribedAt == null,
    courseEmail: contact?.courseEmailOptOutAt == null,
    marketingSms: contact?.smsMarketingConsentAt != null,
    courseSms: contact?.smsTransactionalConsentAt != null,
  };
}

/** STOP/START keywords (src/lib/sms/keywords.ts) own smsOptOutAt; settings never do. */
export const SMS_STOPPED_NOTE = "You replied STOP. Text START to resubscribe.";

export type CommunicationPreferenceRequestBody =
  | { marketingEmail: boolean }
  | { courseEmail: boolean }
  | { phone?: string; smsMarketingConsent: boolean }
  | { phone?: string; smsTransactionalConsent: boolean };

export type CommunicationPreferenceRequestPlan =
  | { ok: true; body: CommunicationPreferenceRequestBody }
  | { ok: false; error: string };

/**
 * The PATCH /api/me body for flipping one /settings switch. Each body carries
 * only that switch's key, so one switch can never rewrite another's field.
 */
export function planCommunicationPreferenceRequest(
  key: CommunicationPreferenceKey,
  enabled: boolean,
  context: {
    savedPhone: string | null;
    enteredPhone: string;
    smsOptOutAt: string | null;
  }
): CommunicationPreferenceRequestPlan {
  if (key === "marketingEmail") return { ok: true, body: { marketingEmail: enabled } };
  if (key === "courseEmail") return { ok: true, body: { courseEmail: enabled } };

  if (context.smsOptOutAt !== null) return { ok: false, error: SMS_STOPPED_NOTE };

  const consent = (phone?: string): CommunicationPreferenceRequestBody => {
    const phoneField = phone === undefined ? {} : { phone };
    return key === "marketingSms"
      ? { ...phoneField, smsMarketingConsent: enabled }
      : { ...phoneField, smsTransactionalConsent: enabled };
  };

  // Turning texts off only nulls that consent; the stored number is untouched.
  if (!enabled) return { ok: true, body: consent() };

  const saved = context.savedPhone?.trim() || null;
  const entered = context.enteredPhone.trim() || null;
  const enteredE164 = entered === null ? null : normalizePhoneE164(entered);

  if (saved !== null) {
    const savedE164 = normalizePhoneE164(saved);
    if (entered !== null && enteredE164 !== savedE164) {
      // Sending a new number here would re-bind every consent to it.
      return { ok: false, error: "Save your new phone number first, then turn on texts." };
    }
    if (savedE164 === null) {
      return { ok: false, error: "Add a valid mobile number before turning on texts." };
    }
    return { ok: true, body: consent() };
  }

  if (enteredE164 === null) {
    return { ok: false, error: "Add a valid mobile number before turning on texts." };
  }
  // First grant: bind the consent to the number it was given for.
  return { ok: true, body: consent(enteredE164) };
}

export type EmailPreferenceWrite = {
  unsubscribedAt?: Date | null;
  courseEmailOptOutAt?: Date | null;
};

export function planEmailPreferenceWrite(
  key: "marketingEmail" | "courseEmail",
  enabled: boolean,
  now: Date,
  currentOptOutAt: Date | string | null = null
): EmailPreferenceWrite {
  if (!enabled && currentOptOutAt !== null) return {};

  return key === "marketingEmail"
    ? { unsubscribedAt: enabled ? null : now }
    : { courseEmailOptOutAt: enabled ? null : now };
}
