# Cohort Messages and SMS Consent

Staff can send one cohort a logistics update by email and, optionally, by text. A send creates a
`COHORT_MESSAGE` drip campaign plus one enrollment per recipient, and the normal drip tick
delivers it ([DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md)). This doc also covers SMS consent end to
end: the fields on `Contact`, where consent is captured, the opt-in confirmation text, inbound
STOP/START, the shared send path and its switches. Email consent scopes and the send-window math
live in [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md); the person record is in [LEADS.md](./LEADS.md).

## Data model

| Model / field | Purpose |
|---|---|
| `Contact.smsMarketingConsentAt` | Consent to promotional texts. Gates SMS steps of `LEAD_SEGMENT` and `BROADCAST` campaigns |
| `Contact.smsTransactionalConsentAt` | Consent to non-marketing texts (cohort reminders, cohort messages, certificate notices) |
| `Contact.phoneConsentAt` | Consent to phone calls only, including automated/AI calls. Never implies SMS consent |
| `Contact.smsOptOutAt` | Set by inbound STOP, cleared by inbound START. Blocks every SMS whatever the consents say |
| `Contact.doNotCall` | Blocks automated calls (not SMS) |
| `Contact.courseEmailOptOutAt` / `unsubscribedAt` | Course and marketing email opt-outs ([DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md)) |
| `Contact.cohortBannerDismissedAt` | Hides the cohort-page "get updates" banner for 7 days |
| `ContactMessage` | One SMS, either direction: `providerSid` (unique), `direction` (OUTBOUND/INBOUND), `status` (QUEUED/SENT/DELIVERED/FAILED/RECEIVED), `body`, numbers, `error`, author, optional `dripSendId` |
| `ContactEvent` type `PHONE_CONSENT` | Audit row per grant/withdrawal made through the person record: `action`, `kind` (`sms_marketing`/`sms_transactional`/`calls`), `source`, `actorUserId` |
| `DripCampaign.cohortId` / `logisticsConfirmedAt` / `idempotencyKey` / `audienceSnapshot` | Cohort-message campaign fields |

`smsableReason(contact, purpose)` in `src/lib/phone.ts` is the single gate. In order it returns
`sms_opt_out`, `no_sms_marketing_consent` / `no_sms_transactional_consent` (or `no_sms_consent`
for purpose `any`, which accepts either consent), `invalid_phone` (not valid E.164), or `null`.

## Sending a cohort message

Admin page `/admin/cohorts/[id]/messages` (id or slug), ADMIN or TEAM_MEMBER only; anyone else is
redirected to `/dashboard`. Both server actions (`actions.ts`) re-check the role and parse input
through `src/lib/cohortMessages/actionGuard.ts`.

1. **Compose.** Subject, plain-text email body, optional SMS body, **Include instructors**, and an
   optional scheduled time entered as wall time in the cohort's timezone (`wallTimeToIso()`
   rejects times that do not exist in that zone).
2. **Preview.** `previewCohortMessage()` is read-only: it resolves the audience without creating
   contacts and returns totals, email and SMS reach, whether SMS is enabled, and the names and
   reasons of people each channel will skip.
3. **Gate.** Send stays disabled until a preview has run for the exact current inputs
   (`composerFingerprint()` over subject, bodies, instructors flag and send time), the SMS text
   validates, and the admin ticks the logistics confirmation. The confirm prompt counts who
   actually receives each channel.
4. **Send.** `sendCohortMessage()` validates again server-side, provisions a `Contact` for any
   recipient missing one (source `cohort-message`), checks the SMS body against the longest first
   name in the audience, then in one transaction creates an ACTIVE campaign (window 0–24, no
   weekend skip, no status exits, timezone from the cohort, `logisticsConfirmedAt`, snapshot) with
   step 1 EMAIL and, only when SMS is enabled, step 2 SMS. Enrollments are created directly
   (outside the one-active-campaign rule) with `nextRunAt` = the scheduled time or now.
5. **Deliver.** The drip tick renders and sends. Merge fields `{firstName}`, `{cohortName}`,
   `{nextSessionDate}`, `{sessionLink}` resolve at send time from the live cohort and its next
   session; unknown `{tokens}` are left as typed. Email values are HTML-escaped, and the composer
   text becomes minimal HTML with autolinked URLs (`plainTextToEmailHtml()`).

**Audience** (`audience.ts`): users with a non-`dropped` enrollment, plus the cohort's
instructors when requested. ADMIN and TEAM_MEMBER users are always excluded; INSTRUCTOR-role
students only appear with **Include instructors**. People are deduplicated by lowercased email.
Consent never removes anyone from the list: email is checked against the course opt-out and SMS
against transactional consent, and blocked channels are reported and later recorded as
`SKIPPED`.

**Idempotency.** The client sends an `idempotencyKey` (max 200 characters). A repeat, or a
concurrent submit that loses the unique-constraint race, returns the first campaign with
`duplicate: true`.

**SMS text rules** (`smsText.ts`): the sent text is `brand.smsSenderPrefix` + merged body +
" Reply STOP to opt out.", with smart quotes, dashes and ellipses normalized. It must be non-empty,
pure GSM-7 (extension characters count double) and at most 320 septets. If an SMS body is given
while SMS is switched off, the send goes out email-only and returns `smsSkipped: "disabled"`.

**History.** The page lists the cohort's last 50 cohort-message campaigns with sender, schedule,
email/SMS counts from the snapshot, and delivered/opened stats.

## Where SMS consent is captured

| Surface | Code | Behavior |
|---|---|---|
| Onboarding quiz | `POST /api/onboarding/[slug]`, `onboarding-phone-consent.ts`, `onboarding-leads.ts` | `phoneConsent: {smsMarketing, smsTransactional, calls}`, each strictly `true`. With no box ticked the phone answer is blanked before validation. Same number: first grant wins, never revoked or re-stamped. New number: each consent becomes exactly what was ticked |
| Settings | `/settings#sms`, `PATCH /api/me`, `communicationPreferences.ts` | One switch per request (`marketingEmail`, `courseEmail`, `smsMarketingConsent`, `smsTransactionalConsent`; `callConsent` from the phone field). Turning texts on needs a valid saved number; a changed number must be saved first. Turning off nulls only that consent. While `smsOptOutAt` is set the SMS switches refuse with "Text START to resubscribe" |
| Account setup | `POST /api/account/setup` (`/set-password`) | Optional transactional SMS consent with a phone; marketing and call consent are preserved, not granted |
| Cohort page banner | `src/app/(dashboard)/cohorts/[id]/bannerActions.ts`, `bannerState.ts` | Enrolled students in ENROLLMENT/IN_PROGRESS cohorts can re-enable course email or add a phone with transactional consent. Not shown for SMS once the person replied STOP |
| Admin edits | `src/app/api/admin/users/[userId]/profile/route.ts` | Staff can change a number but can never grant SMS consent; a changed or cleared number drops consents |

Writes from settings, account setup and the banner go through `setPersonPhone()`
(`src/lib/leads/personRecord.ts`), which applies `planPersonPhoneConsent()` (consent belongs to
the number it was given for) and writes the `PHONE_CONSENT` audit events. Disclosure copy shown
next to each checkbox is in `src/lib/phone.ts` (`SMS_MARKETING_CONSENT_DISCLOSURE`,
`SMS_TRANSACTIONAL_CONSENT_DISCLOSURE`, `CALL_CONSENT_DISCLOSURE`), built from `brand.wordmark`.

**Not SMS consent.** `src/lib/consent.ts`, `POST /api/consent` and `/admin/consent` handle
acceptance of legal documents and the optional media release (`UserConsent`,
`User.marketingReleaseAt`), enforced before paid content only when `CONSENT_GATE_ENABLED=true`.
See [COURSE_ACCESS.md](./COURSE_ACCESS.md).

## Opt-in confirmation

`sendSmsOptInConfirmation()` (`src/lib/sms/optInConfirmation.ts`) runs fire-and-forget after the
quiz and after person-record writes. It sends `SMS_OPT_IN_CONFIRMATION` only when
`SMS_OPTIN_CONFIRMATION_ENABLED` is `true`, the write granted an SMS consent that was not on
file, the contact is not opted out, and the stored phone is already E.164. It sends at most once
per phone number, ever: the `ContactMessage` row is claimed under `providerSid`
`optin-confirm:<phone>` before the Twilio call, so racing or scripted submissions cannot repeat
it. Failures are logged and never surface into the quiz or settings save.

## Inbound SMS and STOP/START

`POST /api/webhooks/twilio/sms` verifies `X-Twilio-Signature` (no auth token configured →
`500`, missing or bad signature → `401`), records the message as an INBOUND `ContactMessage`
(upsert on `MessageSid`, so redelivery is safe) on the most recently updated contact with that
number, and bumps `lastActivityAt`. Unknown senders are acknowledged and dropped.

`src/lib/sms/keywords.ts` matches the whole trimmed, uppercased body. STOP words (`STOP`,
`STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPTOUT`, `REVOKE`) set `smsOptOutAt` and
START words (`START`, `YES`, `UNSTOP`) clear it, on every contact holding that number. The hub
replies with empty TwiML and has no HELP handler; keyword auto-replies, if any, come from Twilio.

`POST /api/webhooks/twilio/sms/status` (same signature check) moves a known `providerSid` to
`DELIVERED` or `FAILED` (with `ErrorCode`); `queued`/`sending`/`sent` callbacks are ignored so
out-of-order callbacks cannot regress a final status.

## Outbound send path

`sendContactSms()` (`src/lib/sms/send.ts`) is the only outbound path for drip SMS steps and the
lead profile's one-off SMS (`sendSmsToLead`, purpose `any`, body capped at 640 characters). It
re-reads the contact, applies `smsableReason()` for the given purpose, writes a QUEUED
`ContactMessage`, sends through Twilio with the status callback above, then marks it SENT or
FAILED. `src/lib/sms/render.ts` renders `{{first_name}}`, `{{name}}`, `{{certificate_url}}`,
`{{cohort_name}}` for drip SMS, drops any other `{{token}}` rather than texting it verbatim, and
caps at 640 characters; cohort messages use their own renderer instead. The drip engine maps
cohort reminder, cohort message and certificate triggers to `transactional`, all others to
`marketing` (`smsPurposeForCampaignTrigger()`). SMS steps are clamped to 09:00–20:00 in the
campaign timezone, so an evening cohort message sends its email at once and its text the next
morning. Details: [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md).

## Backfill

`scripts/backfill-sms-consent.ts` (run with `node --env-file=.env --import tsx`; no npm script)
copies legacy `phoneConsentAt` into both SMS fields for contacts consented under an older
bundled call-and-text disclosure. `--before <ISO timestamp with Z or offset>` is required: the
moment the split consent form went live. Contacts consented or updated at or after it, or with
any SMS consent already set, are skipped (`planSmsConsentBackfill()` in `src/lib/sms/backfill.ts`),
so a withdrawal is never re-granted. Dry-run by default, `--apply` writes; it prints counts only.
New installs that always used the split form do not need it.

## Configuration

| Key | Where | Purpose |
|---|---|---|
| `SMS_TRANSACTIONAL_ENABLED` | Managed key (Admin → Integrations), env fallback | Exactly `true` (case-insensitive) lets cohort messages include their SMS step; anything else sends email only. Keep it off until your A2P campaign is approved |
| `SMS_OPTIN_CONFIRMATION_ENABLED` | `getSecret()` (Integrations store, env fallback); not in the known-keys catalog or `.env.example` | `true` sends the one-time opt-in confirmation |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Managed keys, env fallback | Twilio client, sender number and webhook signature verification |
| `CONSENT_GATE_ENABLED` | Env only | Legal-document gate (not SMS) |

`SMS_TRANSACTIONAL_ENABLED` gates only cohort messages; other drip SMS steps rely on consent
alone. Full list: [../ENVIRONMENT.md](../ENVIRONMENT.md). Twilio number setup:
[TELEPHONY.md](./TELEPHONY.md).

## Gotchas

- **STOP beats everything.** No settings switch, admin edit or backfill clears `smsOptOutAt`;
  only an inbound START does.
- **`phoneConsentAt` is calls only.** Never read it as permission to text.
- **The switch is read at send-creation time.** Turning SMS on later does not add a text step
  to a cohort message already created email-only.
- **Course email opt-out skips only the EMAIL step**; the SMS step still goes to people with
  transactional consent.
- **Preview counts can drift** from the send if enrollments change in between; the send
  re-resolves the audience.

## Key files

| File | Role |
|------|------|
| `src/app/(dashboard)/admin/cohorts/[id]/messages/` | Composer page, client form, server actions |
| `src/lib/cohortMessages/send.ts` | Preview, send, SMS switch |
| `src/lib/cohortMessages/audience.ts` | Recipients and per-channel consent |
| `src/lib/cohortMessages/smsText.ts`, `render.ts` | Merge fields, GSM-7 rules, email HTML |
| `src/lib/cohortMessages/composerState.ts`, `actionGuard.ts` | Send gating, scheduling, input parsing, role check |
| `src/lib/cohortMessages/bannerState.ts` | Cohort-page updates banner |
| `src/lib/phone.ts` | `smsableReason()`, disclosures, confirmation text |
| `src/lib/onboarding-phone-consent.ts`, `src/lib/onboarding-leads.ts` | Quiz consent parsing and grant rules |
| `src/lib/communicationPreferences.ts`, `src/app/api/me/route.ts` | Settings switches |
| `src/lib/leads/personRecord.ts` | `setPersonPhone()`, consent planning, audit events |
| `src/lib/sms/send.ts`, `render.ts` | Outbound SMS |
| `src/lib/sms/keywords.ts`, `src/app/api/webhooks/twilio/sms/` | Inbound SMS, STOP/START, status callbacks |
| `src/lib/sms/optInConfirmation.ts` | One-time opt-in confirmation |
| `src/lib/sms/backfill.ts`, `scripts/backfill-sms-consent.ts` | Legacy consent backfill |

Related: [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md) · [LEADS.md](./LEADS.md) · [TELEPHONY.md](./TELEPHONY.md) · [COURSE_ACCESS.md](./COURSE_ACCESS.md) · [../SECURITY.md](../SECURITY.md) · [../ENVIRONMENT.md](../ENVIRONMENT.md)
