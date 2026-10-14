"use client";

import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { PhoneConsentField } from "@/components/settings/PhoneConsentField";
import { COHORT_UPDATES_BANNER_COPY } from "@/lib/cohortMessages/bannerState";
import {
  addTransactionalSms,
  dismissCohortBanner,
  enableCourseEmails,
} from "@/app/(dashboard)/cohorts/[id]/bannerActions";

export type CohortUpdatesBannerProps = {
  cohortName: string;
  showEmail: boolean;
  showSms: boolean;
};

export function CohortUpdatesBanner({
  cohortName,
  showEmail,
  showSms,
}: CohortUpdatesBannerProps) {
  const [emailVisible, setEmailVisible] = useState(showEmail);
  const [smsVisible, setSmsVisible] = useState(showSms);
  const [smsExpanded, setSmsExpanded] = useState(false);
  const [phone, setPhone] = useState("");
  const [smsTransactionalConsent, setSmsTransactionalConsent] = useState(false);
  const [pendingAction, setPendingAction] = useState<"email" | "sms" | "dismiss" | null>(
    null
  );
  const [error, setError] = useState("");

  if (!emailVisible && !smsVisible) return null;

  const enableEmail = async (): Promise<void> => {
    setError("");
    setPendingAction("email");
    try {
      const result = await enableCourseEmails();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmailVisible(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPendingAction(null);
    }
  };

  const submitSms = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError("");
    setPendingAction("sms");
    try {
      const result = await addTransactionalSms(phone, smsTransactionalConsent);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSmsVisible(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPendingAction(null);
    }
  };

  const dismiss = async (): Promise<void> => {
    setError("");
    setPendingAction("dismiss");
    try {
      const result = await dismissCohortBanner();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmailVisible(false);
      setSmsVisible(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPendingAction(null);
    }
  };

  const isPending = pendingAction !== null;

  return (
    <section className="border-b border-slate-200 bg-slate-50 px-4 py-5 dark:border-slate-700/50 dark:bg-slate-950/40 md:px-8">
      <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700/50 dark:bg-slate-900">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {COHORT_UPDATES_BANNER_COPY.body(cohortName)}
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {emailVisible && (
            <button
              type="button"
              disabled={isPending}
              onClick={enableEmail}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "email" && <Loader2 className="h-4 w-4 animate-spin" />}
              {COHORT_UPDATES_BANNER_COPY.emailButton}
            </button>
          )}
          {smsVisible && !smsExpanded && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError("");
                setSmsExpanded(true);
              }}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {COHORT_UPDATES_BANNER_COPY.smsButton}
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={dismiss}
            className="inline-flex min-h-10 items-center justify-center gap-2 px-2 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
          >
            {pendingAction === "dismiss" && <Loader2 className="h-4 w-4 animate-spin" />}
            {COHORT_UPDATES_BANNER_COPY.dismissButton}
          </button>
        </div>

        {smsVisible && smsExpanded && (
          <form onSubmit={submitSms} className="mt-5 max-w-2xl">
            <PhoneConsentField
              phone={phone}
              phoneConsentAt={null}
              smsMarketingConsentAt={null}
              smsTransactionalConsentAt={null}
              smsMarketingConsent={false}
              smsTransactionalConsent={smsTransactionalConsent}
              callConsent={false}
              smsOptOutAt={null}
              doNotCall={false}
              onPhoneChange={setPhone}
              onSmsMarketingConsentChange={() => undefined}
              onSmsTransactionalConsentChange={setSmsTransactionalConsent}
              onCallConsentChange={() => undefined}
              kinds={["smsTransactional"]}
            />
            <button
              type="submit"
              disabled={isPending}
              className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === "sms" && <Loader2 className="h-4 w-4 animate-spin" />}
              Save text updates
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
