"use client";

import {
  CALL_CONSENT_DISCLOSURE,
  PRIVACY_POLICY_URL,
  SMS_MARKETING_CONSENT_DISCLOSURE,
  SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
  TERMS_OF_SERVICE_URL,
} from "@/lib/phone";

export type PhoneConsentFieldProps = {
  phone: string;
  phoneConsentAt: string | null;
  smsMarketingConsentAt: string | null;
  smsTransactionalConsentAt: string | null;
  smsMarketingConsent: boolean;
  smsTransactionalConsent: boolean;
  callConsent: boolean;
  smsOptOutAt: string | null;
  doNotCall: boolean;
  onPhoneChange: (phone: string) => void;
  onSmsMarketingConsentChange: (consent: boolean) => void;
  onSmsTransactionalConsentChange: (consent: boolean) => void;
  onCallConsentChange: (consent: boolean) => void;
  kinds?: PhoneConsentKind[];
};

export type PhoneConsentKind = "smsMarketing" | "smsTransactional" | "calls";

const ALL_PHONE_CONSENT_KINDS: PhoneConsentKind[] = [
  "smsMarketing",
  "smsTransactional",
  "calls",
];

export function PhoneConsentField({
  phone,
  phoneConsentAt,
  smsMarketingConsentAt,
  smsTransactionalConsentAt,
  smsMarketingConsent,
  smsTransactionalConsent,
  callConsent,
  smsOptOutAt,
  doNotCall,
  onPhoneChange,
  onSmsMarketingConsentChange,
  onSmsTransactionalConsentChange,
  onCallConsentChange,
  kinds = ALL_PHONE_CONSENT_KINDS,
}: PhoneConsentFieldProps) {
  const showsSmsMarketing = kinds.includes("smsMarketing");
  const showsSmsTransactional = kinds.includes("smsTransactional");
  const showsSms = showsSmsMarketing || showsSmsTransactional;
  const showsCalls = kinds.includes("calls");
  const smsConsentLabel = smsOptOutAt
    ? "SMS STOP'd"
    : smsMarketingConsentAt || smsTransactionalConsentAt
      ? "SMS consented"
      : "No SMS consent";

  return (
    <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h3 className="text-sm font-medium text-slate-900 dark:text-white mr-1">
          Phone &amp; messaging
        </h3>
        {showsSms && (
          <span className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            {smsConsentLabel}
          </span>
        )}
        {showsCalls && (
          <span className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            {phoneConsentAt ? "Call consented" : "No call consent"}
          </span>
        )}
        {showsCalls && doNotCall && (
          <span className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            DNC
          </span>
        )}
      </div>

      <div className="max-w-md">
        <label
          htmlFor="profile-phone"
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Phone number
        </label>
        <input
          id="profile-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
        />
      </div>

      <div className="mt-4 space-y-3">
        {showsSmsMarketing && (
          <label className="flex items-start gap-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={smsMarketingConsent}
              disabled={smsOptOutAt !== null}
              onChange={(event) => onSmsMarketingConsentChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>{SMS_MARKETING_CONSENT_DISCLOSURE}</span>
          </label>
        )}
        {showsSmsTransactional && (
          <label className="flex items-start gap-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={smsTransactionalConsent}
              disabled={smsOptOutAt !== null}
              onChange={(event) => onSmsTransactionalConsentChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>{SMS_TRANSACTIONAL_CONSENT_DISCLOSURE}</span>
          </label>
        )}
        {showsCalls && (
          <label className="flex items-start gap-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={callConsent}
              onChange={(event) => onCallConsentChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary/50"
            />
            <span>{CALL_CONSENT_DISCLOSURE}</span>
          </label>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noopener noreferrer" className="underline">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="underline">
            Privacy Policy
          </a>
        </p>
      </div>

      {showsSms && smsOptOutAt !== null && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          You replied STOP. Text START to resume texts.
        </p>
      )}

      {showsCalls && doNotCall && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          You asked not to be called.
        </p>
      )}
    </div>
  );
}
