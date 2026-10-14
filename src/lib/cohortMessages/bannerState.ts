import { smsableReason } from "@/lib/phone";

const ACTIVE_COHORT_STATUSES = new Set(["ENROLLMENT", "IN_PROGRESS"]);
const DISMISSAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type CohortUpdatesBannerContact = {
  phone: string | null;
  smsMarketingConsentAt: Date | string | null;
  smsTransactionalConsentAt: Date | string | null;
  smsOptOutAt: Date | null;
  courseEmailOptOutAt: Date | null;
  cohortBannerDismissedAt: Date | null;
};

export type CohortUpdatesBannerState = {
  showEmail: boolean;
  showSms: boolean;
};

export const COHORT_UPDATES_BANNER_COPY = {
  body: (cohortName: string): string =>
    `Get updates about ${cohortName} by email and text so you don't miss schedule changes.`,
  emailButton: "Turn on email updates",
  smsButton: "Add my phone",
  dismissButton: "Not now",
} as const;

export function cohortUpdatesBannerState(
  contact: CohortUpdatesBannerContact | null,
  cohort: { status: string },
  now: Date
): CohortUpdatesBannerState {
  if (!ACTIVE_COHORT_STATUSES.has(cohort.status)) {
    return { showEmail: false, showSms: false };
  }

  const dismissalCutoff = now.getTime() - DISMISSAL_WINDOW_MS;
  if (
    contact?.cohortBannerDismissedAt &&
    contact.cohortBannerDismissedAt.getTime() > dismissalCutoff
  ) {
    return { showEmail: false, showSms: false };
  }

  const smsReason = smsableReason(
    contact ?? {
      phone: null,
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      smsOptOutAt: null,
    },
    "transactional"
  );

  return {
    showEmail: contact?.courseEmailOptOutAt != null,
    showSms: smsReason !== null && smsReason !== "sms_opt_out",
  };
}
