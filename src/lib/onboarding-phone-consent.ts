export type PhoneConsentChoices = {
  smsMarketing: boolean;
  smsTransactional: boolean;
  calls: boolean;
};

export type ContactConsentTimestamps = {
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  phoneConsentAt: Date | null;
};

export const EMPTY_PHONE_CONSENT: PhoneConsentChoices = {
  smsMarketing: false,
  smsTransactional: false,
  calls: false,
};

export function parseOnboardingPhoneConsent(value: unknown): PhoneConsentChoices {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_PHONE_CONSENT };
  }
  const input = value as Record<string, unknown>;
  return {
    smsMarketing: input.smsMarketing === true,
    smsTransactional: input.smsTransactional === true,
    calls: input.calls === true,
  };
}

export function hasAnyPhoneConsent(consent: PhoneConsentChoices): boolean {
  return consent.smsMarketing || consent.smsTransactional || consent.calls;
}

/**
 * First grant wins; onboarding submissions never revoke or re-stamp consent
 * for the SAME number. Consent belongs to the number it was given for, so when
 * the submission replaces the stored phone, nothing carries over: each consent
 * becomes exactly what was ticked in this submission.
 */
export function planOnboardingConsentGrant(
  existing: ContactConsentTimestamps,
  consent: PhoneConsentChoices,
  now: Date,
  options: { phoneChanged?: boolean } = {}
): Partial<ContactConsentTimestamps> {
  if (options.phoneChanged) {
    return {
      smsMarketingConsentAt: consent.smsMarketing ? now : null,
      smsTransactionalConsentAt: consent.smsTransactional ? now : null,
      phoneConsentAt: consent.calls ? now : null,
    };
  }
  const data: Partial<ContactConsentTimestamps> = {};
  if (consent.smsMarketing && !existing.smsMarketingConsentAt) {
    data.smsMarketingConsentAt = now;
  }
  if (consent.smsTransactional && !existing.smsTransactionalConsentAt) {
    data.smsTransactionalConsentAt = now;
  }
  if (consent.calls && !existing.phoneConsentAt) {
    data.phoneConsentAt = now;
  }
  return data;
}
