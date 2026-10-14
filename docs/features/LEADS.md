# Leads (Internal CRM)

An internal lead store and light pipeline. Leads from onboarding quizzes, asset downloads,
newsletter signups, venue-event registrations and free-seat registrations all land in one
place: the **Leads Database** at `/admin/contacts`. An external CRM (GoHighLevel) is optional.

## Data model

Leads are `Contact` rows (unique by `email`) with a `ContactEvent` timeline. The `Contact` is
also the person record: phone and consent live only here and are linked to a `User` through
`Contact.userId`.

| Field | Meaning |
|-------|---------|
| `email` / `name` / `phone` | Contact info |
| `status` | Pipeline stage: `NEW`, `CONTACTED`, `QUALIFIED`, `WON`, `LOST` |
| `excludeFromPipeline` | Reporting-only exclusion; defaults to `false` |
| `source` | For example `onboarding:{slug}`, `asset_download`, `newsletter`, `venue-event:{slug}`, `manual` |
| `attribution` | JSON first-touch UTM params and click ids ([ATTRIBUTION.md](./ATTRIBUTION.md)) |
| `tags` | JSON `string[]` qualifiers (for example quiz tags) |
| `notes` | Free-form internal scratchpad |
| `lastActivityAt` | Most recent touch |
| `userId`, `linkSource` | Link to a hub account (`auto_email`, `auto_phone`, `manual`) |
| `unsubscribedAt`, `courseEmailOptOutAt` | Email opt-outs (marketing, course) |
| `smsMarketingConsentAt`, `smsTransactionalConsentAt`, `phoneConsentAt`, `doNotCall`, `smsOptOutAt` | Phone consent state |
| `aiBrief`, `aiBriefAt` | Cached AI brief, generated on demand only |

`ContactEvent.type` is one of `ASSET_DOWNLOAD`, `LESSON_VIEW`, `ONBOARDING`,
`NEWSLETTER_SUBSCRIBE`, `VENUE_EVENT_REGISTER`, `MANUAL`, with a JSON `metadata` blob and
per-event UTM columns. Onboarding events carry a unique `onboardingResponseId`, which makes
backfills idempotent.

## How leads are captured

| Source | Endpoint | Behaviour |
|--------|----------|-----------|
| Onboarding quiz | `POST /api/onboarding/[slug]` | Upserts with source `onboarding:{slug}`, merged quiz tags, first-touch attribution; logs an idempotent `ONBOARDING` event. Best-effort, never blocks the quiz ([ONBOARDING.md](./ONBOARDING.md)). |
| Asset download | `POST /api/download-contact` | Upserts with source `asset_download`; logs `ASSET_DOWNLOAD`. |
| Newsletter | `POST /api/public/newsletter/subscribe` | From `/newsletter` and the marketing footer. Single opt-in with a required consent checkbox. Sets source `newsletter` on create only, merges the `newsletter` tag, clears `unsubscribedAt` on a deliberate re-subscribe, logs `NEWSLETTER_SUBSCRIBE`, sends the welcome email. Never writes phone or phone-consent fields. |

Re-submitting updates contact info but does not overwrite the original `source`,
`attribution` or `status`. Old onboarding responses can be backfilled with **Sync Leads** on
`/onboarding-responses`.

## Pipeline exclusion

`excludeFromPipeline` marks records that should not count as prospective customers (test
accounts, staff, instructors, partners, duplicates). It only affects views and aggregates that
describe the sales pipeline. It does **not** delete the contact, change its status, unsubscribe
it, remove it from a drip, or suppress email, SMS or calls.

## The leads table (`/admin/contacts`)

`LeadsClient.tsx` is a filterable table:

- **Status**: inline dropdown per lead (`updateLeadStatus`), with counts in the filter.
- **Notes**: modal editing `Contact.notes` (`updateLeadNotes`).
- **Filters**: search (name, email, phone), status, source, drip state (enrollment status, a
  specific campaign, or not in a campaign), and tag chips (AND-ed). Filter and sort state is
  kept in the URL (`leadListParams.ts`).
- **Pipeline exclusion**: excluded contacts are hidden by default; `?showExcluded=true` shows
  them.
- **Sort**: each header cycles ascending, descending, then the default (`lastActivityAt` desc).
- **Columns**: lead, status, source, Ad Campaign (first-touch UTM, not a drip campaign), Drip
  (status, campaign, step X/N, next run), tags, date added.
- **Export CSV**: exports the filtered set with UTM, click-id, drip and notes columns.

The page loads every non-excluded contact and filters and sorts in the browser. That is fine at
small volume; at several thousand leads the query and sort should move server-side.

## The lead profile (`/admin/contacts/[id]`)

Everything needed before a follow-up, on one page: contact and status, account linking, email
engagement counts, tag editor, first-touch attribution, drip enrollments, form responses with
answers resolved to labels, the notes journal, the AI brief, outreach (one-off email, SMS,
calls, do-not-call), lead bookings ([LEAD_BOOKING.md](./LEAD_BOOKING.md)), and a merged
activity timeline.

### Two note stores

| | `Contact.notes` | `ContactNote` |
|---|---|---|
| Shape | one free-form blob | append-only journal rows |
| Carries | text only | timestamp, author, `kind` (`MANUAL`, `DRIP_TASK`, `SYSTEM`) |
| Edited from | leads-table modal, profile general notes | profile notes box |

Drip `TASK` steps write a `ContactNote` with `kind: DRIP_TASK`; they do not append to the blob.

### Timeline

`src/lib/leads/timeline.ts` merges `EmailEvent`, `ContactEvent`, `DripEnrollment` lifecycle,
`ContactNote`, calls, SMS messages and lead bookings into one reverse-chronological, cursor-paginated feed
(`getTimelinePage`). Do not copy the load-everything pattern of the legacy
`/admin/contacts/activity` page.

All CRM server actions are staff-only (`ADMIN` or `TEAM_MEMBER`) via `assertStaff` in
`src/lib/adminGuard.ts`. `leadStatus.ts` is a plain module so client components can import
`LEAD_STATUSES`; a `"use server"` file may only export async functions.

## The WON invariant

`WON` is reserved for `markLeadWonForPurchase` in `src/lib/leads/autoWon.ts`, which runs only
after a verified purchase grant. Tooling must never set it: the MCP update endpoint refuses
`status: "WON"` case- and whitespace-insensitively. Status changes go through
`changeLeadStatus` (`src/lib/leads/status.ts`), which records the timeline entry, reports
lead-quality transitions as conversions, and supports compare-and-swap.

## MCP endpoints

All require `Authorization: Bearer <HUB_MCP_TOKEN>`. See [../MCP_API.md](../MCP_API.md) for the
companion MCP server.

- `GET /api/internal/mcp/v1/leads`: lead list.
- `GET /api/internal/mcp/v1/leads/facets`: counts. Every `pipeline*` field already excludes
  flagged contacts: `pipelineContactCount`, `pipelineStatuses`, `pipelineSources`,
  `pipelineTags`, `pipelineTagScanCapped`. Also `excludedFromPipelineCount`,
  `allContactCount`, `allContactUnsubscribedCount` (all contacts), `onboardingForms`,
  `dripEnrollmentStatuses`, `dripCampaigns`. The exclusion is applied in the database query,
  before the tag-scan cap.
- `PATCH /api/internal/mcp/v1/leads/update`: batch partial update (below).

### `PATCH /api/internal/mcp/v1/leads/update`

Never creates contacts or replaces records. Also gated by `HUB_MCP_WRITES_ENABLED`, resolved
through the Integrations store with env fallback; any value other than exactly `"true"`
returns `403`.

```json
{
  "updates": [
    {
      "id": "contact-id",
      "status": "QUALIFIED",
      "expectedCurrentStatus": "CONTACTED",
      "excludeFromPipeline": true,
      "tags": ["partner"],
      "tagMode": "add"
    }
  ]
}
```

| Field | Contract |
|-------|----------|
| `updates` | 1 to 50 items; each `id` at most once |
| `id` | Required, trimmed, at most 128 characters |
| `status` | Optional; trimmed and uppercased; `WON` is rejected |
| `expectedCurrentStatus` | Optional compare-and-swap precondition; requires `status` |
| `excludeFromPipeline` | Optional boolean |
| `tags` | Optional; at most 100 entries of at most 100 characters; blanks and duplicates removed |
| `tagMode` | `add` (default when `tags` is present), `remove`, or `replace`; requires `tags` |

Each item must request at least one of `status`, `excludeFromPipeline`, `tags`. Any validation
failure rejects the whole batch with `400` before anything runs.

A valid batch returns `200` even when items fail:

```json
{
  "results": [
    { "id": "contact-1", "ok": true, "applied": ["status", "tags"] },
    { "id": "contact-2", "ok": false, "reason": "conflict", "applied": [],
      "message": "Status changed concurrently; no fields were updated" }
  ],
  "summary": { "requested": 2, "succeeded": 1, "failed": 1 }
}
```

`reason` is `not_found`, `conflict` or `error`. Items run independently. A stale
`expectedCurrentStatus` yields `conflict` and nothing else is applied to that item; if a later
field write fails after a status change, the `error` result's `applied` shows what landed.

| HTTP | Meaning |
|------|---------|
| `400` | Invalid JSON or batch contract (`{ error, correlationId }`) |
| `401` | Missing or wrong bearer token |
| `403` | Writes disabled |
| `413` | Response exceeds the 64 KiB MCP safety limit |
| `500` | `HUB_MCP_TOKEN` is not configured |

## GoHighLevel (optional)

The GHL integration no-ops unless `GHL_API_KEY` and `GHL_LOCATION_ID` are set
([../ENVIRONMENT.md](../ENVIRONMENT.md)). The internal Contact store is the source of truth
either way.

## Key files

| File | Role |
|------|------|
| `src/app/(dashboard)/admin/contacts/page.tsx` | Loads and shapes leads |
| `src/app/(dashboard)/admin/contacts/LeadsClient.tsx` | Table, filters, CSV |
| `src/app/(dashboard)/admin/contacts/actions.ts` | `updateLeadStatus`, `updateLeadNotes`, `updateLeadPipelineExclusion` |
| `src/app/(dashboard)/admin/contacts/leadStatus.ts` | `LEAD_STATUSES` (client-safe) |
| `src/app/(dashboard)/admin/contacts/[id]/page.tsx` | Lead profile (server) |
| `src/app/(dashboard)/admin/contacts/[id]/LeadProfileClient.tsx` | Profile UI |
| `src/app/(dashboard)/admin/contacts/[id]/actions.ts` | Notes, tags, linking, outreach, calls, timeline paging |
| `src/lib/leads/timeline.ts` | Cursor-paginated activity feed |
| `src/lib/leads/pipeline.ts` | Pipeline population totals |
| `src/lib/leads/status.ts` | `changeLeadStatus` |
| `src/lib/leads/autoWon.ts` | `markLeadWonForPurchase` |
| `src/lib/leads/update.ts` | MCP batch parser and executor |
| `src/app/api/internal/mcp/v1/leads/update/route.ts` | MCP update endpoint |
| `src/lib/adminGuard.ts` | `assertStaff`, `staffIdentity` |

Related: [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md) for nurture over this store,
[EMAIL_TRACKING.md](./EMAIL_TRACKING.md) for open/click events,
[CALL_TRANSCRIPTS.md](./CALL_TRANSCRIPTS.md) for call records.
