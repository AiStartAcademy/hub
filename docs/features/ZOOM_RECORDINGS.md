# Zoom Recordings

The hub turns Zoom cloud recordings of cohort sessions into video lessons. Each long MP4
recording is streamed from Zoom into Google Cloud Storage, saved as a `Lesson` in the cohort's
raw recordings Program (module "General"), and linked from the matching `CohortSession` so
students can replay the session from the cohort calendar. Imports are triggered by the Zoom
`recording.completed` webhook or by a manual "sync from Zoom". Shared session series take a
different path and are never imported into a cohort's program (see
[SESSION_SERIES.md](./SESSION_SERIES.md)).

## Data model

| Model | Fields used here |
|-------|------------------|
| `Cohort` | `zoomLink` (join URL of the recurring meeting), `zoomMeetingId`, `rawProgramId` (unique, `onDelete: SetNull`), `programs` |
| `Program` | `rawCohort` (back-relation of `rawProgramId`), `modules`; raw programs use `status: "raw"` |
| `Module` | The import always writes into the module named `General`, creating it if missing |
| `Lesson` | `type: "video"`, `videoUrl` (bare GCS object key), `duration` (seconds), `zoomFileId` (unique, the dedupe key), `order`, `name`; enrichment later fills `intro`, `text`, `tags`, `timecodes`, `posterUrl`, `audioUrl` |
| `CohortSession` | `recordingLink` (`/courses/<rawProgramId>/<lessonId>`), `zoomOccurrenceId` (unique per cohort), `linkedSessionId` |
| `SessionSeries` / `SeriesOccurrence` | `zoomMeetingId` (unique) / `recordingLink` (Zoom share URL); see [SESSION_SERIES.md](./SESSION_SERIES.md) |

A recording is not a separate model: the `Lesson` row holds the playable video, and the
session row only points at it.

## Which program receives the recordings

`Cohort.rawProgramId` is the only import target. It is unique, so one program can be the raw
program of at most one cohort.

- **Admin UI create** (`POST /api/cohorts`) always creates a program named
  `Recordings (<cohort title>)` with `status: "raw"` and a `General` module, sets it as
  `rawProgramId`, and connects it to the cohort's `programs`.
- **MCP create** (`POST /api/internal/mcp/cohort`) sets `rawProgramId` only when
  `rawProgramTitle` names an existing program that no other cohort already owns. Without it the
  cohort has no raw program.
- **Update** (`PUT /api/cohorts/[id]`, body field `rawProgramId`) attaches, replaces or clears
  it. Only `ADMIN` and `TEAM_MEMBER` may change it (an instructor-only user gets `403`). A
  non-string value returns `400`, an unknown program `404`, and a program already owned by
  another cohort `409`. A newly attached program is also added to the cohort's `programs`.

### When a cohort has no recordings program

Nothing is imported and nothing is created; the hub never auto-creates a raw program after the
fact.

- Webhook: the event is acknowledged with `200 OK` and dropped (no lesson, no `recordingLink`).
- `POST /api/cohorts/[id]/sessions/sync` with no body: the schedule is still synced, and the
  recording step is skipped silently.
- The same route with `{ "zoomInstanceUuid": ... }`: `400` with "This cohort has no raw
  recordings program. Set rawProgramId on the cohort first."
- `POST /api/admin/zoom/sync`: schedules sync; recordings are skipped for that cohort.

To recover, attach a program via `PUT /api/cohorts/[id]` and run a sync. Because a plain sync
only sees the latest meeting instance, older sessions need one sync per `zoomInstanceUuid`.

## Webhook flow

`POST /api/webhooks/zoom`:

1. Reads the raw body. If `ZOOM_WEBHOOK_SECRET` is unset, returns `500` (fails closed).
2. Verifies the signature (`src/lib/zoomWebhookSignature.ts`): headers `x-zm-signature` and
   `x-zm-request-timestamp` are required; the timestamp (seconds) must be within 5 minutes of
   server time; the expected value is `v0=` + hex HMAC-SHA256 of `v0:<timestamp>:<rawBody>`
   with the secret, compared in constant time. Any failure returns `401`. This runs before the
   URL validation branch, so validation requests must be signed too.
3. `endpoint.url_validation`: returns `{ plainToken, encryptedToken }`, where
   `encryptedToken` is hex HMAC-SHA256 of `plainToken` with the same secret.
4. `recording.completed`: passes `payload.object.id` (meeting id), `start_time` and
   `share_url` to `handleZoomRecordingCompleted()`:
   - If a `SessionSeries` has that `zoomMeetingId`, the share URL is stored on the series
     occurrence of the same UTC day, and processing stops.
   - Otherwise the first `Cohort` whose `zoomLink` contains the meeting id is used. If it has a
     `rawProgramId`, `syncRecordingsToProgram()` starts in the background (not awaited; errors
     are logged) and the webhook returns immediately.
   - No match, or no raw program: ignored.
5. Every other event is acknowledged with `200 OK` and ignored.

Invalid JSON or an exception during handling returns `400`.

## Import (`syncRecordingsToProgram`)

1. Fetches `GET /v2/meetings/{id}/recordings`. With a numeric id Zoom returns only the latest
   instance of a recurring meeting; with an instance UUID the path uses that UUID
   (double URL-encoded when it starts with `/` or contains `//`, per `zoomRecordingsUrl.ts`). A
   Zoom `404` or a response without `recording_files` ends the run quietly.
2. Loads the raw program; finds or creates the `General` module.
3. Keeps only `file_type: "MP4"` files at least 1200 seconds (20 minutes) long, computing the
   duration from `recording_start`/`recording_end` when `play_duration` is missing, sorted by
   start time. Audio-only, chat and transcript files are skipped.
4. For each file: skips it if a lesson with that `zoomFileId` already exists (re-runs are
   safe); otherwise streams `download_url` to GCS under
   `courses/<program-slug>/general/<lesson-slug>/zoom_<fileId>.mp4` as `video/mp4`.
5. Creates the lesson `Recording - <M/D/YYYY>` (`en-US` date of the recording start),
   `type: "video"`, `videoUrl` = the GCS key, appended to the module order.
6. Finds the cohort's first `CohortSession` on the same UTC day and sets `recordingLink`, then
   copies the link to sessions in other cohorts that borrow this session (`linkedSessionId`)
   and have no recording yet.
7. A failed file is logged and the loop continues. When at least one lesson was added, the
   module and program `updatedAt` are bumped.

Manual syncs first upsert sessions from the meeting's occurrences and then run the import, so a
backfilled instance still finds its session row.

## Storage and playback

Videos live in the private GCS bucket; `Lesson.videoUrl` holds the object key, not a public
URL. Playback goes through `/api/media/[...path]`, which checks program access, so who can watch
a recording follows the raw program's access rules (it is connected to the cohort's
`programs`). See [COURSE_ACCESS.md](./COURSE_ACCESS.md). The cross-cohort recordings feed
(`src/lib/recordings.ts`) lists the latest video lessons to everyone but only selects
`videoUrl`, `posterUrl` and the lesson link for viewers with the `recordings` entitlement.

## Enrichment and audio hand-off

The import creates bare placeholders; nothing else runs automatically. Separately:

- `GET`/`PATCH /api/internal/mcp/v1/lessons/content` list and fill lessons that still lack
  `tags` (or a poster), addressed by `lessonId` or `zoomFileId`. See [../MCP_API.md](../MCP_API.md).
- `POST /api/internal/mcp/v1/lessons/extract-audio` (MCP token, writes enabled) requires a GCS
  `videoUrl` and posts `{ lessonId, videoObjectKey, audioObjectKey, callbackUrl }` to
  `N8N_EXTRACT_AUDIO_WEBHOOK_URL`, returning `202`. The callback
  `POST /api/n8n/extract-audio-callback` requires `Authorization: Bearer <N8N_WEBHOOK_SECRET>`
  and sets `Lesson.audioUrl`. The callback base is `HUB_INTERNAL_URL`, else `NEXT_PUBLIC_APP_URL`.
- `scripts/ingest-zoom-content.ts` is an idempotent local backfill that fills un-enriched lessons
  (matched by `zoomFileId`) from a local cache of Zoom meeting assets; `--dry-run` supported.

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/webhooks/zoom` | Zoom signature | URL validation; `recording.completed` import |
| POST | `/api/cohorts/[id]/sessions/sync` | `TEAM_MEMBER`, `INSTRUCTOR`, `ADMIN` | Sync one cohort's sessions, then recordings; optional `{ zoomInstanceUuid }` |
| POST | `/api/admin/zoom/sync` | Signed in, role not `STUDENT` | Sweep cohorts in `DRAFT`, `ENROLLMENT`, `IN_PROGRESS` with a Zoom link |
| PUT | `/api/cohorts/[id]` | Manage roles; `rawProgramId` admin/team only | Attach, replace or clear the raw program |
| POST | `/api/internal/mcp/v1/lessons/extract-audio` | MCP token + writes | Start n8n audio extraction |
| POST | `/api/n8n/extract-audio-callback` | `N8N_WEBHOOK_SECRET` bearer | Store extracted audio |

Per-cohort sync errors: `404` unknown cohort, `400` no `zoomLink` or bad body (must be a JSON
object; `zoomInstanceUuid` a non-empty string), `422` when Zoom returns no occurrences.

## Configuration

| Variable | Source | Purpose |
|----------|--------|---------|
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Env only | Server-to-Server OAuth (`account_credentials` grant) |
| `ZOOM_WEBHOOK_SECRET` | Env only | Webhook signature and URL validation |
| `ZOOM_HOST_EMAIL` | Read via `getSecret` (Integrations store, env fallback); not in `knownKeys.ts` | Host user for created meetings (default `me`); not used by the import |
| `GCS_PROJECT_ID`, `GCS_CLIENT_EMAIL`, `GCS_PRIVATE_KEY`, `GCS_BUCKET_NAME` | Env only | Video storage |
| `N8N_EXTRACT_AUDIO_WEBHOOK_URL` | Managed key, env fallback | Audio extraction trigger |
| `N8N_WEBHOOK_SECRET` | Listed as a managed key, but the callback reads env only | Callback bearer |
| `HUB_INTERNAL_URL` | Managed key, env fallback | Callback base URL |

Zoom app setup: create a Server-to-Server OAuth app, subscribe its event endpoint to
`https://hub.example.com/api/webhooks/zoom` with the "Recording completed" event, and grant
scopes covering the calls the hub makes: read meetings (`GET /meetings/{id}`), read cloud
recordings (`GET /meetings/{id}/recordings` and file download), and, for meeting provisioning,
create and delete meetings. Meetings must record to the cloud (meetings the hub creates set
`auto_recording: "cloud"`). See [../ENVIRONMENT.md](../ENVIRONMENT.md).

## Security notes

- The webhook fails closed without its secret and rejects stale or unsigned requests. See
  [../SECURITY.md](../SECURITY.md).
- The Zoom download passes the access token as a query parameter; do not log request URLs in
  that path.
- Video keys never reach non-entitled viewers in the recordings feed.

## Gotchas

- A plain sync imports only the latest instance of a recurring meeting. Backfill past sessions
  with `zoomInstanceUuid`.
- Cohort lookup in the webhook is a substring match on `zoomLink` and takes the first match.
  Keep each meeting on one cohort; share a meeting through a session series instead.
- Session matching uses the UTC day of the recording start. A session that crosses UTC midnight
  can be imported as a lesson but left without `recordingLink`.
- Recordings under 20 minutes are never imported.
- The webhook import is not awaited, so a process restart mid-upload can drop it; rerun a
  manual sync (dedupe by `zoomFileId` makes it safe).
- Videos stream from Zoom through the hub process into GCS, so a long recording keeps the
  server busy for the length of the upload. Provider webhook setup: [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Key files

| File | Role |
|------|------|
| `src/app/api/webhooks/zoom/route.ts` | Webhook: signature, URL validation, `recording.completed` |
| `src/lib/zoomWebhookSignature.ts` | `v0` HMAC verification with 5-minute window |
| `src/lib/sessionSeries.ts` | `handleZoomRecordingCompleted()`: series first, then cohort |
| `src/lib/zoom.ts` | OAuth token, meeting and recording API calls, `syncCohortSessions`, `syncRecordingsToProgram` |
| `src/lib/zoomRecordingsUrl.ts` | Recordings URL and instance UUID encoding, sync body parsing |
| `src/lib/cohortRawProgram.ts` | Rules for changing `rawProgramId` |
| `src/lib/sessionLink.ts` | `propagateRecordingLink()` to linked sessions |
| `src/lib/gcs.ts` | `buildObjectKey`, `uploadStreamToGCS` |
| `src/lib/recordings.ts` | Cross-cohort recordings feed with entitlement gating |
| `src/lib/lessonVideos.ts` | Default track choice for multi-language lesson videos |
| `src/app/api/cohorts/[id]/sessions/sync/route.ts` | Per-cohort sync |
| `src/app/api/admin/zoom/sync/route.ts` | All-cohort sweep |
| `src/app/api/internal/mcp/v1/lessons/extract-audio/route.ts` | Audio extraction trigger |
| `src/app/api/n8n/extract-audio-callback/route.ts` | Audio extraction callback |
| `scripts/ingest-zoom-content.ts` | Local content backfill |

Related: [SESSION_SERIES.md](./SESSION_SERIES.md), [COURSE_ACCESS.md](./COURSE_ACCESS.md),
[INTEGRATIONS.md](./INTEGRATIONS.md), [../MCP_API.md](../MCP_API.md),
[../ENVIRONMENT.md](../ENVIRONMENT.md), [../SECURITY.md](../SECURITY.md),
[../DEPLOYMENT.md](../DEPLOYMENT.md).
