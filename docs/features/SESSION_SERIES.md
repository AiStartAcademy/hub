# Session Series

A session series is a recurring call that no single cohort owns, for example a daily check-in
that serves every running cohort at once on one Zoom link. A series is attached to any number of
cohorts. Every student actively enrolled in an attached cohort sees its occurrences next to their
own cohort's sessions. To split the load as headcount grows, create a second series and move a
cohort's attachment to it; to hand over a single date, assign an instructor to that occurrence.

Series occurrences live in their own table on purpose. The per-cohort Zoom sync
(`syncCohortSessions`) deletes cohort session rows whose Zoom occurrence has disappeared and
re-derives titles, so a shared row stored there would be destroyed on the next cohort sync.

## Data model

`SessionSeries`:

| Field | Meaning |
|-------|---------|
| `title`, `description` | Display text |
| `kind` | `CHECKIN` (default) or `ONBOARDING` |
| `status` | `ACTIVE` (default), `PAUSED`, `ARCHIVED` |
| `days` | CSV of `SUN`..`SAT`, stored deduped and in week order |
| `startTime`, `endTime` | 12-hour wall clock in `timezone`, for example `"11:00 AM"` |
| `timezone` | IANA zone, default `America/Los_Angeles` |
| `startDate`, `endDate` | First day; `endDate` null means rolling |
| `zoomLink`, `zoomMeetingId` | The one recurring meeting; `zoomMeetingId` is unique |
| `instructorId` | Default lead (`User`, set null on delete) |

`SessionSeriesCohort` is the attachment: composite key `(seriesId, cohortId)`, cascade-deleted
with either side.

`SeriesOccurrence`:

| Field | Meaning |
|-------|---------|
| `seriesId`, `title` | Parent and display title (`Check-in N` on create) |
| `date`, `startTime`, `endTime` | Start instant, and UTC ISO strings (same convention as `CohortSession`) |
| `timezone`, `status` | Zone from Zoom; `upcoming`, `live` or `completed` snapshot taken at sync |
| `meetingLink`, `recordingLink` | Join URL (the series link) and recording share URL |
| `zoomOccurrenceId` | Zoom occurrence id, unique per series (`@@unique([seriesId, zoomOccurrenceId])`) |
| `instructorId` | Overrides the series default for this date |
| `gcalEventId`, `gcalSyncError`, `gcalSyncedAt` | Calendar sync columns; nothing in the current code writes them |

Zoom occurrence ids are start-time epochs and are not globally unique, which is why the unique
constraint is scoped to the series.

## Lifecycle

1. **Create** at `/admin/sessions/series` (or the API/MCP). `createSeries` requires `title`,
   `days`, `startTime`, `endTime` and `startDate`. An unknown `kind` or `status` on create falls
   back to `CHECKIN` / `ACTIVE`. Days are never inferred: empty or unrecognised weekdays fail.
   Creating does not touch Zoom.
2. **Provision Zoom** with the detail page's **Create Zoom meeting** button
   (`POST /api/admin/session-series/[id]/zoom`). `provisionSeriesZoom` creates one recurring
   fixed-time meeting (`createZoomMeeting`) on the configured host account, stores `zoomLink`
   (the join URL) and `zoomMeetingId`, then syncs occurrences. A bounded series ends on
   `endDate`; a rolling one is provisioned `DEFAULT_HORIZON_WEEKS` (10) weeks ahead, ending the
   day before `startDate + 10 weeks`. Zoom caps a meeting at 60 occurrences and the hub refuses
   to create anything larger rather than truncate it. A series that already has a
   `zoomMeetingId` is refused with `409`.
3. **Sync** (`PUT .../zoom`, **Sync from Zoom**). `syncSeriesOccurrences` fetches the meeting
   with previous occurrences, skips `deleted` ones, and upserts one row per Zoom occurrence.
   Dates, times, zone, status and `meetingLink` are refreshed every sync; `title` is set only on
   create, so hand edits survive. Rows whose occurrence vanished from Zoom are deleted unless
   they carry a recording (the durable record of that call) or have no `zoomOccurrenceId`.
4. **Attach cohorts.** `setSeriesCohorts` takes the full desired set, not a delta, in one
   transaction. Unknown cohort ids reject the whole request. The admin form lists cohorts in
   `DRAFT`, `ENROLLMENT` or `IN_PROGRESS`.
5. **Assign per date.** `updateOccurrence` accepts `title`, `recordingLink` and `instructorId`
   only; date, time and status come from Zoom. The update is scoped by `seriesId`, so one series
   cannot edit another's rows.

Editing a series' schedule does not reshape an already-provisioned Zoom meeting.

## Recordings

`/api/webhooks/zoom` (signature-verified with `ZOOM_WEBHOOK_SECRET`) passes every
`recording.completed` event to `handleZoomRecordingCompleted`, which checks series first:

- If the meeting id matches a `SessionSeries.zoomMeetingId`, the recording `share_url` is written
  to the occurrence on the same UTC calendar day. A series recording is never imported into a
  cohort's raw program, even when no matching occurrence exists.
- Otherwise it falls back to a cohort whose `zoomLink` contains the meeting id and imports in the
  background ([ZOOM_RECORDINGS.md](./ZOOM_RECORDINGS.md)).

Malformed events (no meeting id, invalid start, empty link) are logged and acknowledged so Zoom
does not retry forever; database errors still throw so Zoom retries.

## What viewers see

`seriesVisibilityFilter` is the security boundary between cohorts. Only `ACTIVE` series are
shown to anyone:

| Role | Sees |
|------|------|
| `STUDENT` | Series attached to a cohort with an `active` enrollment for them |
| `INSTRUCTOR` | Series they lead, series with an occurrence assigned to them, series attached to cohorts they teach |
| `ADMIN`, `TEAM_MEMBER` | Every active series |

The effective instructor of an occurrence is its own `instructorId`, else the series default.

| Surface | Behaviour |
|---------|-----------|
| Dashboard (`/dashboard`) | Up to 10 upcoming occurrences merged with cohort sessions |
| Calendar (`GET /api/me/cohort-sessions`) | Up to 500 occurrences from any date, shaped like cohort sessions with the series title as `cohort.title`, `meetingLink` included, flagged `isSharedSeries: true` |
| Cohort page (`/cohorts/[id]`) | Upcoming occurrences of attached series, bounded to the cohort's end date, added to the schedule as `shared: true` entries (title and times only) |

Cohort-session join links go through `resolveJoinLink` in `src/lib/sessionLink.ts` (session link,
else `Cohort.zoomLink`). Series occurrences carry the series link in `meetingLink` directly.
`src/lib/sessionTime.ts` formats times in the session zone and the viewer's zone;
`src/lib/sessionInstant.ts` turns a session row into an absolute UTC interval.

## Routes and endpoints

Admin routes require a signed-in user with a role in `MANAGE_ROLES` (`TEAM_MEMBER`,
`INSTRUCTOR`, `ADMIN`) and return `403` otherwise. The admin pages redirect others to
`/dashboard`.

| Method | Path | Purpose |
|--------|------|---------|
| GET / POST | `/api/admin/session-series` | List with attachments and occurrence counts; create |
| GET / PATCH | `/api/admin/session-series/[id]` | Detail with occurrences; partial update |
| PUT | `/api/admin/session-series/[id]/cohorts` | `{ cohortIds: [...] }`, full set |
| POST / PUT | `/api/admin/session-series/[id]/zoom` | Provision then sync; re-sync (`409` if no usable meeting, `502` on Zoom errors) |
| PATCH | `/api/admin/session-series/[id]/occurrences/[occurrenceId]` | Title, recording link, instructor override |
| GET / POST / PATCH | `/api/internal/mcp/v1/session-series` | MCP list (or one series via `?id=`), create, update and/or `cohortIds` |
| POST | `/api/internal/mcp/cohort/zoom` | MCP: delete a Zoom meeting by `zoomMeetingId` and clear it on matching cohorts |

The MCP routes need `Authorization: Bearer <HUB_MCP_TOKEN>`; writes also need
`HUB_MCP_WRITES_ENABLED` exactly `true`. The MCP surface deliberately cannot provision Zoom
([../MCP_API.md](../MCP_API.md)). Validation errors return `400`, a missing series `404`.

## Configuration

| Key | Source | Purpose |
|-----|--------|---------|
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Env only | Server-to-Server OAuth for create, read, delete |
| `ZOOM_WEBHOOK_SECRET` | Env only | Verifies `/api/webhooks/zoom` |
| `ZOOM_HOST_EMAIL` | Integrations store, env fallback (`getSecret`) | Host user for created meetings; default `me` |

Created meetings use cloud auto-recording, no passcode, no registration and join before host.

## Gotchas

- `startTime`/`endTime` must be 12-hour wall clock (`"6:00 PM"`). The admin form converts
  `<input type="time">` values with `toWallClock`, but API and MCP creates store whatever is sent;
  a value like `"18:00"` is only rejected later, when provisioning fails.
- The first Zoom session is built from the UTC calendar date of `startDate`, and recordings match
  occurrences by UTC day, so a call near midnight UTC can land on the wrong row.
- Nothing in the code extends a rolling series automatically, and re-provisioning is refused while
  `zoomMeetingId` is set. `POST /api/internal/mcp/cohort/zoom` deletes the Zoom meeting but clears
  only `Cohort` rows, not `SessionSeries.zoomMeetingId`, and no API clears that field.
- `PAUSED` and `ARCHIVED` series disappear for every viewer, though their Zoom occurrences stay.
- `ensureRollingCohorts` (`src/lib/cohortRoll.ts`) attaches each cohort it creates to the first
  `ACTIVE` `CHECKIN` series, or records a warning when none exists.
- Series occurrences are not part of cohort reminders or instructor scheduling, which read
  cohort sessions ([INSTRUCTOR_SCHEDULING.md](./INSTRUCTOR_SCHEDULING.md)).

## Key files

| File | Role |
|------|------|
| `src/lib/seriesAdmin.ts` | Create, update, attach cohorts, occurrence edits |
| `src/lib/sessionSeries.ts` | Zoom provisioning, occurrence sync, recording routing |
| `src/lib/seriesSchedule.ts` | Weekday parsing, visibility filter, schedule reads and merge, time helpers |
| `src/lib/zoom.ts` | `createZoomMeeting`, `getMeetingDetails`, `deleteZoomMeeting`, `sessionStatusAt` |
| `src/lib/sessionLink.ts` | Join-link resolution for cohort sessions |
| `src/lib/sessionTime.ts` / `src/lib/sessionInstant.ts` | Display formatting / UTC intervals |
| `src/app/(dashboard)/admin/sessions/series/page.tsx` | Index and create form |
| `src/app/(dashboard)/admin/sessions/series/[id]/page.tsx` | Schedule, cohorts, occurrences |
| `src/app/(dashboard)/admin/sessions/series/[id]/ZoomPanel.tsx` | Provision and sync buttons |
| `src/app/(dashboard)/admin/sessions/series/actions.ts` | Server actions |
| `src/app/api/admin/session-series/` | Admin API |
| `src/app/api/internal/mcp/v1/session-series/route.ts` | MCP endpoint |
| `src/app/api/webhooks/zoom/route.ts` | Recording webhook |
| `src/lib/cohortRoll.ts` | Auto-attach for rolled cohorts |

Related: [COHORTS_PUBLIC.md](./COHORTS_PUBLIC.md), [ZOOM_RECORDINGS.md](./ZOOM_RECORDINGS.md),
[INSTRUCTOR_SCHEDULING.md](./INSTRUCTOR_SCHEDULING.md), [../MCP_API.md](../MCP_API.md),
[../ENVIRONMENT.md](../ENVIRONMENT.md).
