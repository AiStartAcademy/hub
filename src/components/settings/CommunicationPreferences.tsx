"use client";

import type { ReactNode } from "react";
import { Bell, Loader2 } from "lucide-react";
import {
  COMMUNICATION_PREFERENCE_COPY,
  SMS_STOPPED_NOTE,
  type CommunicationPreferenceKey,
  type CommunicationPreferences as CommunicationPreferenceValues,
} from "@/lib/communicationPreferences";
import {
  PRIVACY_POLICY_URL,
  SMS_MARKETING_CONSENT_DISCLOSURE,
  SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
  TERMS_OF_SERVICE_URL,
} from "@/lib/phone";

export type CommunicationPreferencesProps = {
  preferences: CommunicationPreferenceValues;
  smsOptOutAt: string | null;
  pendingKey: CommunicationPreferenceKey | null;
  error: string;
  onToggle: (key: CommunicationPreferenceKey, enabled: boolean) => void;
  /** The phone number and call-consent fields, rendered between email and texts. */
  phoneField: ReactNode;
};

const SMS_DISCLOSURES: Record<"marketingSms" | "courseSms", string> = {
  marketingSms: SMS_MARKETING_CONSENT_DISCLOSURE,
  courseSms: SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
};

function PreferenceSwitch({
  preferenceKey,
  checked,
  disabled,
  pending,
  onToggle,
  children,
}: {
  preferenceKey: CommunicationPreferenceKey;
  checked: boolean;
  disabled: boolean;
  pending: boolean;
  onToggle: (key: CommunicationPreferenceKey, enabled: boolean) => void;
  children?: ReactNode;
}) {
  const copy = COMMUNICATION_PREFERENCE_COPY[preferenceKey];
  const labelId = `pref-${preferenceKey}-label`;
  const descriptionId = `pref-${preferenceKey}-description`;

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-slate-900 dark:text-white">
          {copy.label}
        </p>
        <p id={descriptionId} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {copy.description}
        </p>
        {children}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onToggle(preferenceKey, !checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-primary" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
        </span>
      </button>
    </div>
  );
}

export function CommunicationPreferences({
  preferences,
  smsOptOutAt,
  pendingKey,
  error,
  onToggle,
  phoneField,
}: CommunicationPreferencesProps) {
  const smsStopped = smsOptOutAt !== null;
  const busy = pendingKey !== null;

  return (
    <section
      id="sms"
      aria-labelledby="communication-preferences-heading"
      className="scroll-mt-24 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in"
    >
      <h2
        id="communication-preferences-heading"
        className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-2"
      >
        <Bell className="h-5 w-5 text-primary" />
        Communication preferences
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Each switch saves as soon as you change it.
      </p>

      <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {(["marketingEmail", "courseEmail"] as const).map((key) => (
          <PreferenceSwitch
            key={key}
            preferenceKey={key}
            checked={preferences[key]}
            disabled={busy}
            pending={pendingKey === key}
            onToggle={onToggle}
          />
        ))}
      </div>

      {phoneField}

      <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {(["marketingSms", "courseSms"] as const).map((key) => (
          <PreferenceSwitch
            key={key}
            preferenceKey={key}
            checked={preferences[key]}
            disabled={busy || smsStopped}
            pending={pendingKey === key}
            onToggle={onToggle}
          >
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {SMS_DISCLOSURES[key]}{" "}
              <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noopener noreferrer" className="underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="underline">
                Privacy Policy
              </a>
            </p>
          </PreferenceSwitch>
        ))}
      </div>

      {smsStopped && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{SMS_STOPPED_NOTE}</p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </section>
  );
}
