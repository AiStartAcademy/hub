export type SmsConsentBackfillCandidate = {
  phoneConsentAt: Date | null;
  updatedAt: Date;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
};

/**
 * `cutoff` is when the split consent form went live. Before it, phoneConsentAt
 * was granted under the bundled disclosure that covered texts; from it onward
 * phoneConsentAt means calls only and must never be widened into SMS consent.
 *
 * A contact touched at or after the cutoff is skipped too: a withdrawal in
 * /settings, or a quiz re-submission with the SMS boxes left unticked, leaves
 * the SMS fields null on purpose and bumps updatedAt. The backfill write itself
 * bumps updatedAt, so a second run can never re-grant what someone withdrew.
 */
export function planSmsConsentBackfill(
  contact: SmsConsentBackfillCandidate,
  cutoff: Date
): Pick<
  SmsConsentBackfillCandidate,
  "smsMarketingConsentAt" | "smsTransactionalConsentAt"
> | null {
  if (
    !contact.phoneConsentAt ||
    contact.phoneConsentAt.getTime() >= cutoff.getTime() ||
    contact.updatedAt.getTime() >= cutoff.getTime() ||
    contact.smsMarketingConsentAt ||
    contact.smsTransactionalConsentAt
  ) {
    return null;
  }
  return {
    smsMarketingConsentAt: contact.phoneConsentAt,
    smsTransactionalConsentAt: contact.phoneConsentAt,
  };
}
