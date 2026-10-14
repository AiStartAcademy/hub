# Instructor Scheduling

Gets instructors to commit to cohorts and to specific sessions, then puts confirmed teaching on
Google Calendar and reminds people before they teach. There are two layers. **v1 participation**
asks one question per cohort: "will you teach this cohort, and which sessions can you make?"
**v2 scheduling** proposes individual sessions to individual instructors and lets them accept,
decline or ask for a different time. Instructors never need to log in. Each layer has its own
tokenized no-login page, and an admin works the whole loop from **Teaching**
(`/admin/cohorts/participation`) or through the MCP API.

Public instructor profiles and the `/instructors` roster are covered in
[HUMANS.md](./HUMANS.md).

## Data model

The implicit `Cohort.instructors` many-to-many (`"CohortInstructors"`) is still what public
pages read. `CohortInstructor` is the explicit record that carries confirmation state.
`syncCohortInstructors(cohortId)` keeps the two in step. It runs on cohort create
(`src/lib/cohortCreate.ts`), on admin add/remove (`POST`/`DELETE /api/cohorts/[id]/instructors`),
on MCP cohort PATCH with `instructorEmails`, and from the **Sync** action. When someone is
unassigned, their record is deleted only if it is still `PENDING` and has never been emailed.
Otherwise it stays as history.

| Model | Key fields | Purpose |
|-------|------------|---------|
| `CohortInstructor` | `status` (`PENDING`, `CONFIRMED`, `DECLINED`), `invitedAt`, `respondedAt`, `notes`, `responseToken` (unique) | v1 cohort-level answer; unique on `[cohortId, instructorId]` |
| `CohortSessionInstructorResponse` | `availability` (`AVAILABLE`, `UNAVAILABLE`, `TENTATIVE`, `UNKNOWN`), `note` | v1 per-session availability |
| `SessionAssignment` | `status`, `note`, `adminNote`, `proposedDate`, `proposedStartTime`, `proposedEndTime`, `respondedAt`, `confirmedAt` | v2 negotiation for one instructor on one session; unique on `[cohortInstructorId, sessionId]` |
| `InstructorOutreach` | `subject`, `body` (HTML with merge tokens), `status` (`DRAFT`, `APPROVED`, `SENT`), `createdBy` | One outreach email cycle per cohort |
| `InstructorOutreachSend` | `status` (`SENT`, `FAILED`, `SKIPPED`), `error` | Outreach send log |
| `InstructorReminderSend` | `kind`, `sessionId` (default `""`), `status`, `error` | Idempotency ledger for automated mail; unique on `[cohortInstructorId, kind, sessionId]` |
| `User.scheduleToken` | unique, nullable | The v2 cross-cohort schedule link |
| `CohortSession` | `instructorId`, `gcalEventId`, `gcalSyncError`, `gcalSyncedAt` | Lead instructor and calendar mirror |

`SessionAssignment.status` is one of `PROPOSED`, `ACCEPTED`, `CHANGE_REQUESTED`, `COUNTERED`,
`DECLINED`, `CONFIRMED`. Participation tracking only covers cohorts in `ENROLLMENT` or
`IN_PROGRESS`.

## v1: cohort participation and outreach

1. **Sync** creates a `CohortInstructor` for each assigned instructor.
2. **Draft** creates a `DRAFT` `InstructorOutreach`. The admin UI fills in a default subject and
   body. MCP requires both. The merge tokens are `{{first_name}}`, `{{cohort_title}}`,
   `{{cohort_dates}}`, `{{sessions_html}}` and `{{respond_url}}`. Values are HTML-escaped.
3. **Approve** sets `APPROVED`. `sendOutreach()` refuses a `DRAFT`, so approval is the human gate.
4. **Send** emails every `PENDING` record, or only the `only` record ids if given. A recipient
   with a `SENT` send for this outreach in the last 24 hours is skipped unless `force` is set.
   `{{sessions_html}}` lists only that person's assigned sessions. If they have none, it lists
   the whole cohort, or just the cohort's date range when the cohort has no sessions yet. A
   successful send stamps `invitedAt`, and the outreach becomes `SENT`.
5. **Nudge** sends the latest `APPROVED`/`SENT` outreach again to records that are still
   `PENDING`.

`{{respond_url}}` (and the email button) goes to `/instructor-schedule/{scheduleToken}` if the
instructor has a schedule token. Otherwise it goes to `/instructor-response/{responseToken}`.
On that v1 page the instructor picks `CONFIRMED` or `DECLINED`, can add notes (2,000 chars) and
marks availability per session (1,000-char notes). Session ids outside the cohort are ignored.
Answers can be changed at any time.

## v2: per-session proposals and negotiation

`proposeSchedule(cohortId, instructorIds?, sessionIds?)` creates `PROPOSED` assignments.
Usually it is scoped to the one or two sessions a person actually teaches. Leave out
`sessionIds` to propose every session. Running it again is safe: existing assignments are
never reset. Session ids that are not in the cohort are reported back, and both the admin
action and MCP turn them into an error. `unassignSession` deletes an assignment only while it
is still `PROPOSED`.

| Move | Who | Effect |
|------|-----|--------|
| Accept | Instructor | `ACCEPTED`. No calendar event yet. |
| Request change | Instructor | `CHANGE_REQUESTED`, saving `proposedDate`/`proposedStartTime`/`proposedEndTime` (wall-clock in the session's zone). The real session does not move. |
| Decline | Instructor | `DECLINED`, clears `confirmedAt`, re-syncs the session's calendar event |
| Accept all | Instructor | Accepts every open assignment in one cohort and sets the v1 `CohortInstructor.status` to `CONFIRMED` |
| Accept change | Admin | Moves the `CohortSession` to the proposed date/times, sets `CONFIRMED`, syncs the calendar. This is the only path that changes a session's time. |
| Counter | Admin | Sets the assignment back to `PROPOSED` with an `adminNote` that the instructor sees |
| Confirm | Admin | `CONFIRMED`, makes the instructor the session's lead `instructorId` if none is set, syncs the calendar |

The schedule page (`getInstructorSchedule`) covers every tracked cohort the instructor is on.
It shows a calendar and agenda, flags sessions that overlap in real time (declined sessions are
left out), and lists **full-day opportunities**. A full-day opportunity is a date where the
instructor already teaches one half of the day and a different tracked cohort has a session in
the other half. A session that starts at 5:00 PM or later, in its own zone, counts as evening.

## Google Calendar sync

`syncCohortSessionToGcal(sessionId)` keeps **one event per session**. Its attendees are the
instructors with a `CONFIRMED` assignment plus `GOOGLE_CALENDAR_ORGANIZER_EMAIL`, deduplicated
case-insensitively. Re-syncing recomputes the attendee list and patches the event. If no
confirmations are left, the event is deleted (`sendUpdates: "all"`) and `gcalEventId` is
cleared. An event that was deleted directly in Google (404/410) is recreated once. Every Google
call has a 10-second timeout. A failure writes `gcalSyncError` on the session and never throws
to the caller. When the four required variables are missing, sync returns `skipped`.

## Reminders and the runner

`tick()` in `src/lib/instructorReminders.ts` works out what is due from the database on every
run:

- **Proposal nudges**: for each `PENDING` `CohortInstructor` in a tracked cohort whose
  `invitedAt` is at least 3 days old. `PROPOSAL_NUDGE_1` is sent before day 7 and
  `PROPOSAL_NUDGE_2` from day 7 on. Each is sent at most once.
- **Session reminders**: for each `CONFIRMED` assignment with a future start, `SESSION_T72` is
  sent within 72 hours and `SESSION_T24` within 24 hours. Only the tightest matching window
  fires per tick. The email includes the cohort location and the session's meeting link.

`sendOnce()` checks the ledger before sending and writes a row after every attempt: `SENT`,
`FAILED` (the error is stored), or `SKIPPED` when mail is not configured. A `FAILED` or `SKIPPED`
row also uses up that slot, so the reminder is not retried.

| Method | Route | Auth | Behaviour |
|--------|-------|------|-----------|
| `POST` | `/api/internal/instructor/tick` | `Bearer DRIP_CRON_TOKEN` | Runs `tick()`, returns per-bucket `sent`/`skipped`/`failed` counts and `smtpConfigured`; `500` on error |
| `GET` | `/api/internal/instructor/tick` | `Bearer DRIP_CRON_TOKEN` | Read-only queue depth: `nudgeCandidates`, `confirmedAssignments`, `changeRequests`, ledger counts by status, `smtpConfigured` |

The token is resolved through `getSecret()` (Integrations store, env fallback) and compared in
constant time. A missing token fails closed with `500`. Schedule this route every 15 minutes,
next to the drip runner ([../DEPLOYMENT.md](../DEPLOYMENT.md), [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md)).

## Routes and surfaces

| Surface | Auth | Purpose |
|---------|------|---------|
| `/instructor-schedule/[token]` | `User.scheduleToken` | v2 cross-cohort schedule with accept / request change / decline / accept all |
| `/instructor-response/[token]` | `CohortInstructor.responseToken` | v1 confirm or decline plus per-session availability |
| `/admin/cohorts/participation` ("Teaching" in the sidebar) | `ADMIN` or `TEAM_MEMBER` | Per-cohort roster with Sync, Draft, Approve, Send, Nudge, a session picker (propose/unassign), a change-request inbox (accept/counter) and a copy-link button for the schedule link |
| `POST`/`DELETE /api/cohorts/[id]/instructors` | Manage roles; an instructor can only add or remove themselves | Edits the m2m, then runs the participation sync |

## MCP endpoints

All of these require `Authorization: Bearer <HUB_MCP_TOKEN>`. Writes also need
`HUB_MCP_WRITES_ENABLED` to be `true` ([../MCP_API.md](../MCP_API.md)).

- `GET /api/internal/mcp/v1/instructor-participation?cohortId=` returns the rollup (cohorts,
  instructors, status, assigned and unanswered session ids, availability), the outreach list and
  the open change requests. Response tokens are removed.
- `POST /api/internal/mcp/v1/instructor-participation` with `{ action, ... }`. Every action is
  behind the writes flag, including the read-like ones:
  - `sync`, `draft` (`cohortId`, `subject`, `body`).
  - `preview`: renders a sample email with a placeholder token, plus recipients and their
    assigned-session counts.
  - `approve`, `send` (`only`, `force`), `nudge`.
  - `propose` (`instructorIds`, `sessionIds`), `unassign` (`cohortInstructorId`, `sessionId`).
  - `list_changes`.
  - `respond_change`: `assignmentId` plus `decision` of `accept`, `counter` (needs `adminNote`)
    or `confirm`.
  - `gcal_sync`: one `sessionId`, or every session with a confirmed assignment in a `cohortId`.
  - `schedule` (`instructorId`): the schedule view with `scheduleToken` removed.
- `GET /api/internal/mcp/v1/instructors` and `PATCH .../instructors/profile` cover profiles only
  ([HUMANS.md](./HUMANS.md)).

## Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `DRIP_CRON_TOKEN` | Integrations store, env fallback (not in the curated key list; add it as a custom key) | Runner bearer token |
| `HUB_MCP_TOKEN`, `HUB_MCP_WRITES_ENABLED` | Integrations store, env fallback | MCP auth and write gate |
| `SMTP_HOST` (and the other `SMTP_*` keys) | Integrations store, env fallback for sending; see the Gotchas for outreach | Mail transport |
| `DRIP_FROM`, `DRIP_REPLY_TO` | Env only on these code paths | Sender for outreach and reminders |
| `NEXT_PUBLIC_APP_URL` | Env only | Base URL for the links in outreach and reminder emails |
| `GOOGLE_CALENDAR_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` | Env only, read at module load | All four are required, or calendar sync is skipped |
| `GOOGLE_CALENDAR_ORGANIZER_EMAIL` | Env only | Optional organizer attendee |

## Token security

Both tokens are bearer capability URLs. Anyone with the link can act as that instructor.

- `responseToken` is a Prisma `cuid()`, created with the record. It covers one cohort-instructor
  record and can only write that record's answer and availability.
- `scheduleToken` is a `crypto.randomUUID()`, created on demand by `ensureScheduleToken()` when
  an admin copies the link or by the paired-cohort invite. Every schedule action looks the token
  up again and checks that the assignment belongs to that instructor.
- Tokens are stored **in plaintext** and looked up by exact match. They are not hashed, have no
  expiry and cannot be rotated from the UI. Both pages are `noindex`, and MCP responses never
  include either token.

## Gotchas

- **Confirming has no button in the admin UI.** `confirmAssignmentAction`, the calendar resync
  action and the paired-cohort invite exist as server actions, but none of the admin components
  call them. `ACCEPTED` sessions only reach the calendar through MCP
  `respond_change` / `decision: "confirm"`, or when an admin accepts a change request.
- **`COUNTERED` is never written.** A counter sets the assignment back to `PROPOSED` and adds an
  `adminNote`. The UI only treats `COUNTERED` as "open".
- **Nudges look at v1 status.** Accepting sessions one by one does not change
  `CohortInstructor.status`. Only "accept all" or the v1 page does, so a person who answered
  each session separately can still get proposal nudges.
- **Outreach checks SMTP through env only.** `sendOutreach()` checks `process.env.SMTP_HOST`
  before recording a send. If SMTP is configured only in the Integrations store, mail is sent,
  but the send is logged as `SKIPPED` and `invitedAt` is never set, so no nudges follow.
- **Session reminders are never retried.** A `FAILED` or `SKIPPED` ledger row uses up that
  reminder for good.
- The calendar event description links to `/instructor-schedule` with no token, so that link
  does not open anyone's schedule.

## Key files

| File | Role |
|------|------|
| `src/lib/instructorParticipation.ts` | m2m sync, participation rollup, tracked statuses |
| `src/lib/instructorSchedule.ts` | v2 proposals, negotiation moves, conflicts, full-day pairing, schedule tokens |
| `src/lib/instructorOutreach.ts` | Outreach, nudge and session-reminder email rendering; `sendOutreach()` |
| `src/lib/instructorReminders.ts` | Reminder `tick()` and queue depth |
| `src/lib/googleCalendar.ts` | `syncCohortSessionToGcal()` (also venue and lead-booking sync) |
| `src/app/api/internal/instructor/tick/route.ts` | Runner endpoint |
| `src/app/instructor-schedule/[token]/` | v2 schedule page |
| `src/app/instructor-response/[token]/` | v1 response page |
| `src/app/actions/instructorSchedule.ts`, `src/app/actions/instructorResponse.ts` | Token-checked server actions |
| `src/app/(dashboard)/admin/cohorts/participation/` | Admin Teaching page and actions |
| `src/app/api/internal/mcp/v1/instructor-participation/route.ts` | MCP endpoint |

Related: [HUMANS.md](./HUMANS.md) · [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md) · [USER_ROLES.md](./USER_ROLES.md) · [../MCP_API.md](../MCP_API.md) · [../DEPLOYMENT.md](../DEPLOYMENT.md) · [../ENVIRONMENT.md](../ENVIRONMENT.md)
