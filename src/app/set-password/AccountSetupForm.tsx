"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  PRIVACY_POLICY_URL,
  SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
  TERMS_OF_SERVICE_URL,
} from "@/lib/phone";

export const ACCOUNT_SETUP_SMS_HEADING = "Get class reminders by text (optional)";

export const ACCOUNT_SETUP_SMS_CONTENT = {
  heading: ACCOUNT_SETUP_SMS_HEADING,
  disclosure: SMS_TRANSACTIONAL_CONSENT_DISCLOSURE,
  termsUrl: TERMS_OF_SERVICE_URL,
  privacyUrl: PRIVACY_POLICY_URL,
} as const;

export type AccountSetupSmsState = {
  phone: string;
  smsTransactionalConsent: boolean;
};

export function defaultSmsConsentState(): AccountSetupSmsState {
  return { phone: "", smsTransactionalConsent: false };
}

export type AccountSetupPayload = AccountSetupSmsState & {
  token: string;
  password: string;
};

export function buildAccountSetupPayload(
  input: AccountSetupPayload
): AccountSetupPayload {
  return { ...input };
}

/**
 * Copy shown when the API rejects the token. An expired or already-used link is
 * the common case (the email sat in the inbox), so instead of a dead end the
 * visitor gets both recovery paths: re-register for a fresh link, or sign in
 * with Google using the same email — the account already exists on our side.
 */
export const EXPIRED_LINK_COPY =
  "This link may have expired. Register again for the event to get a fresh link, or sign in with Google using the same email.";

/**
 * True when the API says the setup token is unknown, used, or expired. Matches
 * only the token-failure message — "Invalid setup link or password." also
 * fires for a weak password and must keep its own wording.
 */
export function isExpiredLinkError(apiError: unknown): boolean {
  return typeof apiError === "string" && /link is invalid or has expired/i.test(apiError);
}

/** Maps the API error body to the message rendered under the form. */
export function accountSetupErrorMessage(apiError: unknown): string {
  if (isExpiredLinkError(apiError)) return EXPIRED_LINK_COPY;
  if (typeof apiError === "string" && apiError) return apiError;
  return "Could not set up the account.";
}

export default function AccountSetupForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [smsState, setSmsState] = useState(defaultSmsConsentState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/account/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildAccountSetupPayload({ token, password, ...smsState })
        ),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(accountSetupErrorMessage(data.error));
        return;
      }

      setComplete(true);
    } catch {
      setError("Could not set up the account.");
    } finally {
      setSubmitting(false);
    }
  };

  if (complete) {
    return (
      <div className="text-center space-y-6">
        <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Account ready</h1>
          <p className="mt-2 text-slate-500">You can now sign in and access your cohort.</p>
        </div>
        <Link href="/login?callbackUrl=/cohorts" className="inline-flex w-full justify-center rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-dark">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Set up your account</h1>
        <p className="mt-2 text-sm text-slate-500">Create a password to access your cohort workspace.</p>
      </div>

      {!token && (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">This setup link is missing its token.</p>
      )}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </label>

      <p className="text-xs leading-5 text-slate-500">Use at least 8 characters with uppercase, lowercase, a number, and a symbol.</p>

      <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          {ACCOUNT_SETUP_SMS_CONTENT.heading}
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Mobile phone
          </span>
          <input
            type="tel"
            autoComplete="tel"
            value={smsState.phone}
            onChange={(event) =>
              setSmsState((current) => ({ ...current, phone: event.target.value }))
            }
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
        <label className="flex items-start gap-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={smsState.smsTransactionalConsent}
            onChange={(event) =>
              setSmsState((current) => ({
                ...current,
                smsTransactionalConsent: event.target.checked,
              }))
            }
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary/50"
          />
          <span>{ACCOUNT_SETUP_SMS_CONTENT.disclosure}</span>
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <a
            href={ACCOUNT_SETUP_SMS_CONTENT.termsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Terms
          </a>{" "}
          and{" "}
          <a
            href={ACCOUNT_SETUP_SMS_CONTENT.privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Privacy
          </a>
        </p>
      </section>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          <p>{error}</p>
          {error === EXPIRED_LINK_COPY && (
            <p className="mt-2">
              <Link href="/login" className="font-medium underline">
                Sign in with Google →
              </Link>
            </p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!token || submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? "Setting up…" : "Set password"}
      </button>
    </form>
  );
}
