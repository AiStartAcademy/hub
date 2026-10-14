import {
  CERTIFICATE_TRIGGER,
  COHORT_MESSAGE_TRIGGER,
  COHORT_TRIGGER,
} from "./constants";

/** Email consent is split between course updates and marketing/news messages. */
export type EmailScope = "course" | "marketing";

export const COURSE_EMAIL_TRIGGERS = [
  COHORT_TRIGGER,
  COHORT_MESSAGE_TRIGGER,
  CERTIFICATE_TRIGGER,
] as const;

/**
 * Maps a campaign trigger to its email-consent scope. This mirrors
 * `smsPurposeForCampaignTrigger`: course logistics use their own consent while
 * every other campaign remains marketing.
 */
export function emailScopeForCampaignTrigger(trigger: string): EmailScope {
  return (COURSE_EMAIL_TRIGGERS as readonly string[]).includes(trigger)
    ? "course"
    : "marketing";
}

export type EmailScopeReason = "unsubscribed" | "course_email_opt_out";

/**
 * Returns the opt-out reason for one email scope. This mirrors `smsableReason`:
 * neither scope overrides the other, and each checks only its own field.
 */
export function emailScopeReason(
  contact: {
    unsubscribedAt: Date | null;
    courseEmailOptOutAt: Date | null;
  },
  scope: EmailScope
): EmailScopeReason | null {
  if (scope === "course") {
    return contact.courseEmailOptOutAt ? "course_email_opt_out" : null;
  }
  return contact.unsubscribedAt ? "unsubscribed" : null;
}

/** Only the exact public value `course` selects the course-email scope. */
export function parseEmailScopeParam(value: unknown): EmailScope {
  return value === "course" ? "course" : "marketing";
}
