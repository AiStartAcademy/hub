# Drip Campaigns

Scheduled, multi-step outreach over the Leads CRM ([LEADS.md](./LEADS.md)). A lead lands in
`Contact` (onboarding quiz, asset download, newsletter, abandoned checkout, inbound call), and a
drip campaign segments, waits, and sends until the lead converts, exits, or opts out. The same
engine also delivers cohort reminders, broadcasts, certificate notices and cohort messages.

This is not [TRANSACTIONAL_EMAIL.md](./TRANSACTIONAL_EMAIL.md) (one message per user action).
Drip mail reuses its `sendMail()` primitive but has its own scheduler and suppression rules.

## Architecture

```
cron (every ~15 min)
   │  POST /api/internal/drip/tick   (Authorization: Bearer DRIP_CRON_TOKEN)
   ▼
src/lib/drip/engine.ts : tick()
   ├─ syncAbandonedCheckouts()   abandoned checkouts → tagged leads (abandoned.ts)
   ├─ enrollEligibleLeads()      ACTIVE + autoEnroll campaigns, lowest priority first
   ├─ enrollCohortAudiences()    safety-net sweep for cohort reminder campaigns
   └─ runDueSteps()              every ACTIVE DripEnrollment with nextRunAt <= now:
                                 consent/exit checks → render → send → advance or COMPLETE
```

Admin UI: `/admin/contacts/campaigns` and `/admin/contacts/campaigns/[id]`. Opt-out page: `/unsubscribe?token=…`.

## The tick endpoint

`src/app/api/internal/drip/tick/route.ts`, `force-dynamic`, responses are `no-store`.

- **Auth:** `requireManagedServiceToken(req, "DRIP_CRON_TOKEN")` (`src/lib/serviceAuth.ts`). The
  expected token is resolved with `getSecret()` (Admin → Integrations value first, then the
  `DRIP_CRON_TOKEN` env var). The request must carry `Authorization: Bearer <token>`; the
  comparison is timing-safe over SHA-256 digests. No token configured → `500 Server
  misconfigured` (fails closed). Missing or wrong header → `401`. There is no session or cookie
  path. The same token also guards `/api/internal/instructor/tick`.
- **`POST`** runs one tick. Optional JSON body: `sendLimit` (clamped 1–500, default 100) and
  `skipEnroll: true` (skip the abandoned-checkout sync and both enrollment sweeps). Returns the
  tick result: `200`, or `207` when any send failed, or `500` if the tick threw.
- **`GET`** (same auth) sends nothing and returns `{now, activeCampaigns, activeEnrollments,
  dueNow, failedSends, smtpConfigured}` for monitoring.

```bash
curl -X POST https://hub.example.com/api/internal/drip/tick \
  -H "Authorization: Bearer $DRIP_CRON_TOKEN"
```

Calling more often or concurrently is safe (invariant 2). Scheduling: [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Data model

| Model / field | Purpose |
|---|---|
| `DripCampaign` | `slug`, `status` (DRAFT/ACTIVE/PAUSED/ARCHIVED), `trigger`, `segment` (JSON), `autoEnroll`, `exitOnStatuses` (JSON), `priority`, send window, `testEmail`, broadcast fields (`sentAt`, `audienceSnapshot`), cohort-message fields (`cohortId`, `logisticsConfirmedAt`, `idempotencyKey`) |
| `DripStep` | `order`, `delayHours`, `anchor` (ENROLLMENT/COHORT_START) + `offsetMinutes`, `channel` (EMAIL/TASK/CALL/SMS), subject/body/CTA, CALL overrides `callAssistantId`/`callFirstMessage` |
| `DripEnrollment` | One contact in one campaign: `status`, `lastStepOrder`, `nextRunAt`, `cohortId` (`""` for non-cohort campaigns), `exitReason`. Unique on `[campaignId, contactId, cohortId]` |
| `DripSend` | One delivered/failed/skipped step, unique on `[enrollmentId, stepId]`; open/click rollups (see [EMAIL_TRACKING.md](./EMAIL_TRACKING.md)) |
| `ContactNote` | TASK steps write an internal note here (kind `DRIP_TASK`) instead of sending |
| `ContactCall` / `ContactMessage` | CALL and SMS step records, linked by `dripSendId` |
| `Contact.unsubscribedAt` / `courseEmailOptOutAt` / `unsubscribeToken` | Marketing opt-out, course opt-out, one-click link secret |

SQLite has no enums or JSON: unions live in schema comments; list fields are JSON strings.

## Engine invariants

Documented in the header of `src/lib/drip/engine.ts`:
1. **One active enrollment per lead, globally.** A lead matching several `LEAD_SEGMENT`
   campaigns joins exactly one: the lowest `priority`.
2. **One send per (enrollment, step), forever.** The `DripSend` row is claimed before the
   provider call, so a crash, double tick, or concurrent runner cannot double-send.
3. **The opt-out for the campaign's email scope wins everywhere:** in the segment matcher, at
   enrollment, and again just before each send.
4. **Segment membership is evaluated at enrollment only.** Ongoing exits come from
   `exitOnStatuses` and opt-outs, never from re-matching the segment.
5. **Deferral, never early sending.** A step due outside the window moves to the next opening.

## Triggers

`DripCampaign.trigger` selects the campaign type (`src/lib/drip/constants.ts`):

| Trigger | Audience | Email scope | SMS purpose |
|---|---|---|---|
| `LEAD_SEGMENT` | Leads matching `segment` | marketing | marketing |
| `BROADCAST` | One-shot snapshot (see below) | marketing | marketing |
| `COHORT_SCHEDULE` | Cohort registrants | course | transactional |
| `CERTIFICATE_ISSUED` | Certificate holders, on admin request | course | transactional |
| `COHORT_MESSAGE` | One cohort's students (+ optional instructors) | course | transactional |

**Cohort reminders (`COHORT_SCHEDULE`).** The segment is ignored. Registrants are enrolled at the
fire points (Stripe webhook seat grant, `POST /api/cohorts/[id]/register-free`,
`POST /api/cohorts/[id]/enroll`) via `enrollInCohortReminderCampaigns()`
(`src/lib/drip/cohortAnchor.ts`), which upserts a `Contact` (tag-add only, `cohort:<slug-or-id>`,
never overwriting lead attribution) and creates a cohort-scoped enrollment. Steps with
`anchor: COHORT_START` are due at the cohort start plus `offsetMinutes` (negative is before
start); the start instant comes from `cohortStartInstant()` (start date/time in the cohort's
zone, first-session fallback). Late registrants skip steps already due, and at send time a step
more than 45 minutes past due, or past the cohort start, is recorded as `SKIPPED`. Free
registrations pass `skipWelcome` because that route sends its own confirmation.

**Broadcasts (`BROADCAST`).** `sendBroadcast()` (`src/lib/drip/broadcast.ts`) resolves the
audience once with `resolveBroadcastAudience()` (`audience.ts`), the union of segment-matching
leads, users (all, or one cohort's), and product buyers, then applies suppressions last: no
contact, unsubscribed, `no-drip` tag, staff, cohort instructors. It writes one enrollment per
contact, sets the campaign ACTIVE with `sentAt` and `audienceSnapshot`, and lets the normal tick
deliver. The campaign is archived once every enrollment completes. Dry-run first via the
editor or `POST /api/internal/mcp/v1/drip/broadcast`.

**Certificate notices (`CERTIFICATE_ISSUED`).** Created only when an admin clicks **Notify
students** on a cohort, via `enrollCertificateNotifications()` (`certificateNotify.ts`), which
stamps `Certificate.notifiedAt` so re-runs only reach new holders. See
[CERTIFICATES.md](./CERTIFICATES.md).

**Cohort messages (`COHORT_MESSAGE`).** Admin page `/admin/cohorts/[id]/messages` (ADMIN or
TEAM_MEMBER), linked as **Message cohort** from the cohort workspace. The audience
(`src/lib/cohortMessages/audience.ts`) is users with a non-`dropped` enrollment, plus instructors
when **Include instructors** is on; ADMIN and TEAM_MEMBER users are always excluded. Send stays
disabled until a preview has run for the current inputs and the admin confirms it is a
logistics update (stored as `logisticsConfirmedAt`). `sendCohortMessage()` creates the campaign
(0–24 window, no status exits) and enrollments in one transaction; a unique `idempotencyKey`
makes retries return the first campaign. Merge fields: `{firstName}`, `{cohortName}`,
`{nextSessionDate}`, `{sessionLink}`. SMS text is prefixed with `brand.smsSenderPrefix`, ends
"Reply STOP to opt out.", must be GSM-7 and at most 320 characters, and is only sent while the
managed key `SMS_TRANSACTIONAL_ENABLED` is `true`.

Cohort, certificate and cohort-message campaigns bypass invariant 1, `exitOnStatuses` and the
email send window. Their scope's opt-out still applies.

## Email consent scopes

`src/lib/drip/emailScope.ts`: `emailScopeForCampaignTrigger()` and `emailScopeReason()` decide
everything. Only triggers listed in `COURSE_EMAIL_TRIGGERS` are course mail; any new trigger is
marketing unless added there deliberately.

| Scope | Blocked by | Opt-out link |
|---|---|---|
| marketing | `Contact.unsubscribedAt` | `/unsubscribe?token=…` |
| course | `Contact.courseEmailOptOutAt` | `/unsubscribe?token=…&scope=course` |

A marketing opt-out exits the enrollment. A course opt-out only skips EMAIL steps (`SKIPPED`,
`course_email_opt_out`); SMS steps still go out on transactional SMS consent. Course emails get
their own footer and `List-Unsubscribe` target. Students manage both scopes under
**Settings → Communication preferences** (`/settings#sms`); `CohortUpdatesBanner` on the cohort
page invites enrolled students with course email off or no transactional SMS consent to opt back
in (hidden 7 days after dismissal, only for ENROLLMENT/IN_PROGRESS cohorts).

## Segments

`DripSegment` (`src/lib/drip/segment.ts`): `sources` (`onboarding:*` wildcard), `statuses`,
`anyTags` / `allTags` / `noneTags`, `minAgeHours`, `maxAgeDays`, `inactiveForDays`, `callable`,
`smsable`, plus broadcast-only `cohorts`, `products`, `includeUsers`.

- `candidateWhere()` is a cheap Prisma prefilter (SQLite cannot filter tags in SQL).
- `matchesSegment()` is the exact predicate and the authority; the prefilter may only be wider.
- `countSegmentMatches()` powers **Preview audience** and reports what the sweep would enroll.

## Send windows

`src/lib/drip/schedule.ts`. Each campaign has an IANA `timezone`, `sendWindowStartHour` /
`sendWindowEndHour` (end exclusive) and `skipWeekends`. `scheduleStep()` adds `delayHours` to the
previous send, then `nextWindowOpening()` walks forward hour by hour (DST-safe, bounded to 14
days). An inverted or empty window falls back to all day. CALL steps are clamped to 10:00–18:00
weekdays (`clampWindowForCalls`), SMS steps to 09:00–20:00 (`clampWindowForSms`), both
intersected with the campaign window.

## Rendering and merge fields

`src/lib/drip/template.ts` renders a step into the branded HTML shell and always appends the
unsubscribe footer. Tokens (`src/lib/drip/mergeFieldTokens.ts`): `first_name`, `name`, `email`,
`unsubscribe_url`, `app_url`, `cohorts_url`, `booking_url`, `upcoming_cohorts`, `next_cohort`,
`abandoned_item_title`, `abandoned_amount`, `resume_checkout_url`, `cohort_name`,
`cohort_start_date`, `cohort_start_time`, `zoom_link`, `venue_address`, `cohort_url`,
`certificate_id`, `certificate_url`, `certificate_pdf_url`, `certificate_png_url`,
`linkedin_add_url`. Every token has a safe fallback when its context is absent.

- Contact-derived values are always HTML-escaped. `{{upcoming_cohorts}}` and `{{next_cohort}}`
  are the only trusted HTML, rendered from live cohort rows at send time; each row links to that
  cohort's own page.
- Staff-authored step HTML goes through `sanitizeEmailBody` (`src/lib/sanitize.ts`).
- `src/lib/drip/link-utm.ts` tags every `href` at render time with `utm_source=email`,
  `utm_medium=drip`, `utm_campaign=<campaign slug>`, `utm_content=step<N>-<derived from path>`
  (CTA gets a `-cta` suffix). Stored URLs stay clean. `mailto:`/`tel:` and the unsubscribe link
  are never tagged; already-tagged links are left alone.
- Open/click tracking is applied after UTM tagging: [EMAIL_TRACKING.md](./EMAIL_TRACKING.md).

**Sender.** `resolveDripFrom()` in `engine.ts` reads the managed `DRIP_EMAIL_FROM` key (bare
address or full mailbox); `Reply-To` is its bare address. If unset or unreadable it falls back
to the default From/Reply-To constants in `template.ts`, derived from `src/config/brand.ts`.
Drip and one-off outreach mail carry RFC 8058 `List-Unsubscribe` headers
(`unsubscribeHeaders()`); see [TRANSACTIONAL_EMAIL.md](./TRANSACTIONAL_EMAIL.md).

## Cart recovery

Checkout writes a `Payment` or `Membership` but no `Contact`. `syncAbandonedCheckouts()`
(`src/lib/drip/abandoned.ts`) runs inside every tick and turns abandoned cohort, program and
membership checkouts from the last 30 days (`failed`, or `pending` past `expiresAt`) into leads
with sources `checkout_abandoned` / `program_checkout_abandoned` / `membership_abandoned` and
matching tags. Rules: never overwrite an existing lead's source, status or attribution (tags and
`lastActivityAt` only); skip buyers, and move tagged buyers to `WON` so `exitOnStatuses` exits
them; never touch unsubscribed contacts; idempotent on `Contact.email`.

`abandoned_item_title`, `abandoned_amount` and `resume_checkout_url` resolve from the contact's
latest abandoned row (`Payment.checkoutUrl`, replaced by Stripe's recovery URL after expiry).
The Stripe webhook stamps `Payment.recoveredAt` when an expired checkout completes through
Stripe's recovery flow; `/admin/sales` reports it as a subset of collected revenue, so treat it
as a floor ([PAYMENTS.md](./PAYMENTS.md)).

## Seeded campaigns

`npm run seed:drip` (`scripts/seed-drip-campaigns.ts`) installs `SEED_CAMPAIGNS` from
`src/lib/drip/campaigns.ts`. It is create-only by default; `npm run seed:drip -- --force`
overwrites settings and replaces steps (enrollments and send history survive, hand edits do
not). Structurally the seed creates:

- **Lead nurtures** (`LEAD_SEGMENT`, ACTIVE): a general onboarding-quiz nurture plus
  goal-specific variants keyed on `goal-*` tags, an asset-download follow-up (24h minimum age),
  a `QUALIFIED` close sequence with a TASK step, and a 30-day dormant revival at low priority.
  These exit on `QUALIFIED`/`WON`/`LOST`, which hands a qualified lead to the close sequence.
  Each CTA step gets an `{{upcoming_cohorts}}` block inserted automatically.
- **Recovery** (ACTIVE or DRAFT): cohort, membership and program abandoned-checkout sequences
  at the highest priorities, no weekend skipping.
- **Lifecycle** (DRAFT): a self-paced buyer welcome, a next-cohort launch sequence, and a
  newsletter welcome below the commercial nurtures.
- **Course mail** (DRAFT): `cohort-pre-start` (`COHORT_SCHEDULE`) and `certificate-issued`
  (`CERTIFICATE_ISSUED`, includes an SMS step).

Replace seeded copy before activating. Never hardcode prices or dates; use `{{next_cohort}}`.

## CALL and SMS channels

- **CALL** dials via Vapi (`src/lib/vapi/client.ts`). The engine re-checks `callabilityReason()`
  (`src/lib/phone.ts`: not `doNotCall`, `phoneConsentAt`, valid E.164); not callable → `SKIPPED`,
  Vapi error → `FAILED`. Results arrive at `POST /api/webhooks/vapi`
  ([VAPI_RECEPTIONIST.md](./VAPI_RECEPTIONIST.md)). Put `callable: true` in the segment.
- **SMS** is gated by `smsableReason(contact, smsPurposeForCampaignTrigger(trigger))` over
  independent `smsMarketingConsentAt` / `smsTransactionalConsentAt`; `smsOptOutAt` (inbound
  STOP, `src/lib/sms/keywords.ts`) blocks all SMS. `phoneConsentAt` covers calls only.

## Gotchas

- **Opens are directional, bounces invisible** ([EMAIL_TRACKING.md](./EMAIL_TRACKING.md)).
- **Failed sends are not retried.** A `FAILED` `DripSend` still holds its slot and the
  enrollment advances. Recover manually from the editor (re-enroll or manual send).
- **MCP refuses to replace steps** on a campaign whose status forbids it (`409`); edit those in
  the admin editor. MCP tooling: [../MCP_API.md](../MCP_API.md).
- **Test sends** (`testEmail`) bypass enrollment, window and ledger, and carry no
  `List-Unsubscribe` headers.
- **Run now** on the campaign list calls the same `tick()` capped at 25 sends.

Key code: `src/lib/drip/`, `src/lib/cohortMessages/`, `src/app/(dashboard)/admin/contacts/campaigns/`.
Related: [../ARCHITECTURE.md](../ARCHITECTURE.md) · [../SECURITY.md](../SECURITY.md) · [INTEGRATIONS.md](./INTEGRATIONS.md) · [ATTRIBUTION.md](./ATTRIBUTION.md)
