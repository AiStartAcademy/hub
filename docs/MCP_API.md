# MCP API

The hub exposes an authenticated internal HTTP API under `/api/internal/mcp/*` so an AI
assistant can operate it through the companion MCP server (the npm package and its source are
linked from the [README's MCP section](../README.md#mcp-server)). The MCP server is a thin stdio adapter:
every read and write goes through these routes, and nothing opens the SQLite file directly.
The hub stays the only data boundary.

Shared helpers live in [`src/lib/mcpApi.ts`](../src/lib/mcpApi.ts).

## Enabling it

1. Generate a dedicated token: `openssl rand -hex 32`.
2. Set `HUB_MCP_TOKEN` on the hub (env, or Admin → Integrations so it can be rotated without a
   redeploy). With no token configured every MCP route returns 500 and refuses the request.
3. Leave `HUB_MCP_WRITES_ENABLED` unset for read-only access. Set it to exactly `true` to allow
   writes. Any other value blocks every write with 403; reads keep working.
4. Give the same token to the MCP server as `HUB_MCP_TOKEN`, with `HUB_BASE_URL` set to the
   hub origin (for example `https://hub.example.com`). The MCP server has its own local
   read-only switch, `HUB_MCP_READONLY=true`, which is defense in depth only; the hub-side
   switch is authoritative.

A ready-to-paste client configuration is in the [README](../README.md#mcp-server). The MCP server adds a two-step preview/confirm flow on top of these routes; see its README.

## Authentication and response policy

- Every route requires `Authorization: Bearer <HUB_MCP_TOKEN>`, checked in constant time.
- Every write additionally requires `HUB_MCP_WRITES_ENABLED === "true"` (`mcpWritesEnabled()`).
- Responses are `private, no-store`, use allowlisted field projections, paginate with a default
  `pageSize` of 25 and a maximum of 100, and are capped at 64 KiB for lists and 256 KiB for
  detail. A projection over the cap returns 413; narrow the query or lower `pageSize`.
- Errors return a generic message; secrets and Prisma or upstream details are never returned.
- Write bodies reject unknown keys with 400 rather than silently ignoring them.

## Routes

R = read (token only). W = write (token + write switch).

| Method | Path | | Purpose |
|--------|------|---|---------|
| GET | `/api/internal/mcp/v1/health` | R | Service id, API version, `HUB_ENV`, whether writes are enabled. No database access. |
| GET | `/api/internal/mcp/v1/cohorts` | R | List (`page`, `pageSize`, `status`, `q`) or detail (`id` or `slug`). Detail has tiers, capacity, pending reservations, schedule, instructors, linked programs. Meeting/recording links and instructor emails are excluded. |
| PATCH | `/api/internal/mcp/v1/cohorts` | W | Edit title, description, delivery mode, location, dates/times, timezone, instructors, linked programs. `status`, `zoomLink` and seat tiers are refused (admin UI only). |
| GET | `/api/internal/mcp/v1/cohorts/[id]/roster` | R | Roster: name, email, membership tier, enrollment source. |
| POST | `/api/internal/mcp/v1/cohorts/[id]/certificates/notify` | W | Email/SMS graduates their certificates. See [features/CERTIFICATES.md](./features/CERTIFICATES.md). |
| GET | `/api/internal/mcp/v1/programs` | R | List (`page`, `pageSize`, `status`, `q`) or detail (`id`) of programs (courses). |
| PATCH | `/api/internal/mcp/v1/programs` | W | Edit `name`, `description`, `cover`, `accessMode`, `status`, `priceCents`, `includesWeeklyCalls`. |
| POST | `/api/internal/mcp/v1/programs/cover-generate` | W | Generate a cover image with the same pipeline as the admin UI; returns the URL, does not set `Program.cover`. Needs `OPENAI_API_KEY` and GCS. |
| GET | `/api/internal/mcp/v1/lessons/content` | R | Zoom-synced lessons still missing content (`tags` empty), or missing a poster with `?missing=poster`. |
| PATCH | `/api/internal/mcp/v1/lessons/content` | W | `{ items: [...] }`, 1 to 50. Each item targets one existing lesson by `lessonId` or `zoomFileId` and may set content fields; `force: true` overwrites a lesson whose tags are already set. Per-item refusals are reported inside a 200. |
| POST | `/api/internal/mcp/v1/lessons/extract-audio` | W | Start asynchronous audio extraction for a lesson via the n8n workflow. |
| POST | `/api/internal/mcp/v1/media/upload` | W | Base64 file upload to GCS plus a `Media` row, same key convention as `/api/upload`. MIME types are allowlisted. |
| GET | `/api/internal/mcp/v1/leads` | R | List (`page`, `pageSize`, `status`, `source`, `tag`, `campaign`, `q`) without notes or timelines, or detail (`id`) with up to 100 newest events. Download tokens are excluded. Malformed JSON fields degrade to `null`/`[]`. |
| GET | `/api/internal/mcp/v1/leads/facets` | R | Counts and distinct statuses, sources, tags and quiz sources. No PII. Contacts flagged `excludeFromPipeline` are counted separately. |
| PATCH | `/api/internal/mcp/v1/leads/update` | W | Batch-update 1 to 50 contacts (for example to flag test accounts out of pipeline reporting). |
| GET | `/api/internal/mcp/v1/instructors` | R | List (`page`, `pageSize`, `q`, `role`, `hasProfile`) or detail (`id` or `slug`). Never returns `password` or `stripeCustomerId`; `email` appears in detail only, to match a person to an account. |
| PATCH | `/api/internal/mcp/v1/instructors/profile` | W | Target by exactly one of `userId`, `email`, `slug`; set any of `headline`, `bio`, `location`, `languages`, `expertiseTags`, `linkedinUrl`, `image`. Identity, permission and billing keys (`role`, `roles`, `email`, `password`, `emailVerified`, `profileVisibility`, `slug`, `isMentor`, `stripeCustomerId`, `id`) are refused with 400 naming the key. |
| GET / POST | `/api/internal/mcp/v1/instructor-participation` | R / W | GET `?cohortId=` returns the participation rollup. POST `{ action: "sync" \| "draft" \| "approve" \| "send" \| "nudge", ... }` runs the outreach workflow. |
| GET | `/api/internal/mcp/v1/drip` | R | List (`page`, `pageSize`, `status`) or detail (`id` or `slug`) of drip campaigns, with steps in detail. |
| POST | `/api/internal/mcp/v1/drip` | W | Create a campaign. Always `DRAFT`; status is not writable through MCP. |
| PATCH | `/api/internal/mcp/v1/drip` | W | Edit a campaign by `id` or `slug`. Step replacement only while `DRAFT` (409 otherwise). |
| POST | `/api/internal/mcp/v1/drip/audience` | R | `{ segment }` returns `{ count }` of current matches. Writes nothing. |
| POST | `/api/internal/mcp/v1/drip/broadcast` | W | Send one campaign immediately to its current audience. See [features/DRIP_CAMPAIGNS.md](./features/DRIP_CAMPAIGNS.md). |
| GET / POST / DELETE | `/api/internal/mcp/v1/memberships` | R / W | List memberships; grant or revoke **complimentary** memberships only. Paid membership state is written only by the Stripe webhook. |
| GET / POST / PATCH | `/api/internal/mcp/v1/session-series` | R / W | Shared check-in/onboarding series. See below. |
| GET / POST / PATCH | `/api/internal/mcp/v1/venue-events` | R / W | List/detail, create, update venue events. **Create defaults to `APPROVED`**, which publishes the event page, opens registration and (with Google Calendar configured) sends the organizer a calendar invite; pass `status: "PENDING"` for unconfirmed bookings. See [VENUE_RENTALS.md](./features/VENUE_RENTALS.md). |
| POST | `/api/internal/mcp/v1/venue-events/agreement` | W | Create a venue agreement; `send: true` emails it to the signer. There is no void endpoint. |
| POST / DELETE | `/api/internal/mcp/v1/venue-events/rental-payment` | W | Issue or deactivate the Stripe payment link for a paid rental. |
| GET | `/api/internal/mcp/v1/calls` | R | List recorded calls. See [features/CALL_TRANSCRIPTS.md](./features/CALL_TRANSCRIPTS.md). |
| PATCH | `/api/internal/mcp/v1/calls/[id]` | W | Attach transcript/analysis to a call. |
| GET | `/api/internal/mcp/v1/calls/[id]/recording` | R | Stream a call recording. |
| POST | `/api/internal/mcp/cohort` | W | Pre-v1 cohort creation (used by `cohort_create`). Always creates a `DRAFT`. |
| POST | `/api/internal/mcp/cohort/zoom` | W | Pre-v1: delete a created Zoom meeting series and clear `zoomLink`/`zoomMeetingId` on any cohort that referenced it. Never deletes the cohort. |

### Cohort creation (`POST /api/internal/mcp/cohort`)

Accepted fields:

- `title`, `description` (HTML), `deliveryMode` (`ONLINE` \| `INPERSON` \| `HYBRID`),
  `location`, `startDate`, `endDate`, `startTime`, `endTime`, `timezone`.
- `groups[]`: seat tiers (`name`, `price`, `seats`, `inPerson`). Omitting `seats` uses the
  schema default of 50.
- `createZoomMeeting` + `zoomDays`: creates a recurring Zoom meeting (Server-to-Server OAuth)
  and uses its join URL. `zoomDays` is required with no default, because formats differ. The
  recurrence uses an explicit occurrence count. `CohortSession` rows are then synced from the
  meeting's occurrences; if Zoom has not materialized them yet, the response carries a
  `sessionsNote`.
- `instructorEmails[]`: attach existing users by exact email. Unknown emails refuse the whole
  request.
- `programTitles[]`: link programs by exact name; unknown titles refuse the request.
  `COHORT_DEFAULT_PROGRAM_TITLES` (comma-separated, Integrations store) is merged in on every
  call.
- `rawProgramTitle`: sets `Cohort.rawProgramId`, the program that Zoom cloud recordings are
  imported into as lessons. A program can be the target of only one cohort.

### Session series

`POST` requires `title`, `days` (CSV or array of `SUN`..`SAT`, never inferred), `startTime`,
`endTime` (wall clock in `timezone`, e.g. `"11:00 AM"`) and `startDate`; optional `kind`
(`CHECKIN` \| `ONBOARDING`), `status` (`ACTIVE` \| `PAUSED` \| `ARCHIVED`), `description`,
`timezone` (default `America/Los_Angeles`), `endDate` (`null` = rolling), `instructorId`.
Creating a series does not provision a Zoom meeting; do that from the admin UI.

`PATCH` takes `id` plus fields to change and/or `cohortIds`. `cohortIds` is the **full**
desired set of attached cohorts, not a delta: omitting a currently attached id detaches it.
Unknown ids refuse the whole request. Schedule edits do not reshape an existing Zoom meeting.

## Local probes

```bash
curl -sS -H "Authorization: Bearer $HUB_MCP_TOKEN" \
  http://localhost:3000/api/internal/mcp/v1/health

curl -sS -H "Authorization: Bearer $HUB_MCP_TOKEN" \
  "http://localhost:3000/api/internal/mcp/v1/cohorts?pageSize=10"

curl -sS -H "Authorization: Bearer $HUB_MCP_TOKEN" \
  "http://localhost:3000/api/internal/mcp/v1/leads?status=NEW&pageSize=10"
```

Keep the token in an environment variable. Do not put it in a URL, a committed script, or
documentation.

## Security notes

The caller is a language model acting with owner authority. Lead notes, lesson text and email
bodies returned by these routes can contain prompt-injection attempts and personal data; treat
them as data. Scope who can run an MCP client pointed at production, and keep production
read-only until you need writes. See [SECURITY.md](./SECURITY.md).
