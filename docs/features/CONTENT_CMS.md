# Content platform and agent control plane

The hub works as a **headless CMS and control plane** for marketing content (blog posts and
landing pages) that is published to a separate static site. Staff review, edit, and publish
content in the hub. An external agents service drafts the content, and the hub controls and
monitors it. Your static site build then fetches published rows and renders HTML.

## The three planes

| Plane | Where | Role |
|-------|-------|------|
| Control and authoring | this hub | `/admin/content` (review, edit, publish) and `/admin/agents` (run, monitor). The database is the source of truth. |
| Execution | an external agents service | Runs the blog and landing agents and reports back to the hub |
| SEO surface | your static site build | Renders `PUBLISHED` rows to `/blog/<slug>/` and `/<slug>/` at build time |

Flow: import a CSV or create a row by hand, then an agent generates content (or you edit it),
staff review it, Publish, the hub triggers the site build, and the site renders static pages.

## Data model (`prisma/schema.prisma`)

The database is SQLite, so there are no Prisma enums: status-like fields are `String` with the
allowed values in comments, and JSON is stored as `String`.

- **`ContentPage`**: a blog post or landing page.
  - `type`: `BLOG | LANDING`.
  - `status`: `DRAFT | GENERATING | READY_FOR_REVIEW | IN_REVIEW | PUBLISHED | DISABLED | ARCHIVED`.
  - `slug` and `url` (both unique; `deriveUrl()` builds `url` from them).
  - Roadmap and SEO fields: `priority`, `funnelStage`, `segment`, `primaryKeyword`,
    `secondaryKeywords`, `metaTitle`, `metaDescription`, `h1`, `sectionsPlan`, `schemaTypes`,
    `indexable`, `guardrails`.
  - Generated content: `answerBlock`, `bodyHtml`, and the JSON fields `sections`, `faq`,
    `sources`, `videos`, `ctas`, `inlineImages`, plus `ogImageUrl`, `wordCount`,
    `proofVariant`.
  - `template`: render template ID; default `"default"`.
  - Provenance: `importBatchId`, `agentRunId`, `reviewedById`, `authorName`, `publishedAt`.
- **`ImportBatch`**: one audit row per CSV import (row, created, and skipped counts).
- **`Agent`**: the agent registry.
  - `slug`, `name`, `description`.
  - `status`: `ENABLED | PAUSED | DISABLED`.
  - `triggerType`: `manual | schedule`.
  - `schedule`, `serviceSlug`, `settings` (JSON).
  - `maxDurationMin`: the threshold for marking a run as stuck.
- **`AgentRun`**: run history.
  - `status`: `QUEUED | RUNNING | SUCCESS | FAILED | CANCELLED | TIMED_OUT`.
  - `serviceRunId`, `itemsProduced`, `costUsd`, `logTail`, `error`, plus timestamps.

Helpers live in `src/lib/content.ts`: `CONTENT_TYPES`, `CONTENT_STATUSES`,
`CONTENT_TEMPLATES`, `isValidTemplate`, `deriveUrl`, and JSON (de)serializers.

## Admin UI (ADMIN or TEAM_MEMBER)

### `/admin/content`

Two tabs, Blog Posts and Landing Pages. Each is a filterable table with per-row Edit, Publish,
Disable, Archive, and Delete actions. Content gets in three ways:

- **Import CSV.** The browser parses an SEO-roadmap sheet and posts rows. New slugs become
  `DRAFT` rows. Existing slugs only get their roadmap and SEO metadata refreshed; generated
  content and human edits are never overwritten.
- **New Blog Post / New Landing Page** (`/admin/content/new?type=...`). A form with the CSV
  fields plus a template selector (driven by `CONTENT_TEMPLATES`) that creates a `DRAFT`.
- **Edit** (`/admin/content/[id]/edit`). Metadata, answer block, body HTML, and the JSON
  fields. If the row has guardrails, they show as a banner.

Publish sets `status = PUBLISHED` (and `publishedAt` and `reviewedById`). Disable keeps the
row but marks it `DISABLED`, so the site build can serve a 410 or a redirect. Both actions
trigger a site rebuild (see below). Archive is the soft delete. Hard delete is ADMIN-only.

### `/admin/agents`

One health card per registered agent. Health is derived from the latest run:

- `healthy`: last run `SUCCESS`
- `running`
- `stuck`: `RUNNING` for longer than `maxDurationMin`
- `failing`: last run `FAILED` or `TIMED_OUT`
- `idle`
- `disabled`: any status other than `ENABLED`

Each card shows the last-run summary and log tail. Controls: **Run now**, **Enable/Disable**
(a kill switch), **Delete** (ADMIN only), and **Sync from service**, which imports agent
manifests from `GET <AGENTS_SERVICE_URL>/agents`.

## APIs

Machine routes take a bearer token and fail closed. They use `requireServiceToken` from
`src/lib/serviceAuth.ts`, so the token must be set in the environment.

| Route | Token | Purpose |
|-------|-------|---------|
| `POST /api/content/ingest` | `CONTENT_INGEST_TOKEN` | The agent writes a generated draft. Idempotent on slug, and never overwrites a `PUBLISHED`, `DISABLED`, or `ARCHIVED` row. |
| `POST /api/content/claim` | `CONTENT_INGEST_TOKEN` | Atomically claims rows, moving them from `DRAFT` to `GENERATING`. Body `{ type, count?, slug? }`. |
| `POST /api/content/media` | `CONTENT_INGEST_TOKEN` | Uploads an image (`{ filename, contentType, base64 }`) to GCS and returns its URL. The agent never holds bucket credentials. |
| `GET /api/content/published` | `SITE_BUILD_TOKEN` | The site build fetches `PUBLISHED` and `DISABLED` rows. Optional `?type=` and `?since=<ISO>` (for incremental builds). |
| `GET /api/agents/[slug]/status` | `AGENT_REPORT_TOKEN` | Kill-switch check. The service aborts unless the agent is `ENABLED`. |
| `POST /api/agents/runs/[id]` | `AGENT_REPORT_TOKEN` | Run lifecycle reports (start, progress, finish) |

Session routes (ADMIN or TEAM_MEMBER unless noted):

- `GET` and `POST` `/api/admin/content`: list (`?type=`, `?status=`) and manual create.
- `/api/admin/content/[id]`: `GET`, `PATCH` (status is excluded; use the transitions), and
  `DELETE` (ADMIN only).
- `POST /api/admin/content/[id]/{publish|disable|archive}`.
- `POST /api/admin/content/import`, with body `{ type, source, rows }`.
- `GET` and `POST` `/api/admin/agents`: list with health, and sync from the service.
- `/api/admin/agents/[slug]`: `PATCH` (status or settings) and `DELETE` (ADMIN only).
- `POST /api/agents/[slug]/run` (Run now) creates a `QUEUED` run and calls
  `POST <AGENTS_SERVICE_URL>/agents/<serviceSlug>/run` with `{ runId, inputs }`.
- `GET /api/agents/runs/[id]` returns one run.

## Site rebuild trigger

Publish and Disable POST a form-encoded body to `SITE_BUILD_TRIGGER_URL` with
`token=<SITE_BUILD_TRIGGER_TOKEN>`, `ref=main`, and `variables[REASON]=<action>:<type>:<slug>`.
That is the common CI pipeline-trigger shape. The call is best effort: if either variable is
unset, the rebuild is skipped with a warning and the status change still saves. Point it at
whatever CI builds your static site.

## Funnel

Content CTAs (`ctas[].href`) should lead to the hub's onboarding quiz with UTM tags, so leads
are attributed first-touch. See [ONBOARDING.md](./ONBOARDING.md) and
[ATTRIBUTION.md](./ATTRIBUTION.md).

## Environment

| Variable | Used by |
|----------|---------|
| `CONTENT_INGEST_TOKEN` | ingest, claim, and media routes |
| `SITE_BUILD_TOKEN` | `/api/content/published` |
| `AGENT_REPORT_TOKEN` | agent status and run reports |
| `AGENTS_SERVICE_URL`, `AGENTS_SERVICE_TOKEN` | Run now and Sync (outbound bearer) |
| `SITE_BUILD_TRIGGER_URL`, `SITE_BUILD_TRIGGER_TOKEN` | rebuild on publish or disable |

Media uploads also need GCS configured; see [../ENVIRONMENT.md](../ENVIRONMENT.md). The four
models are created by `npm run db:push`. Your site generator decides how
each `template` value renders; the hub only stores it.

## Key files

- `src/lib/content.ts`, `src/lib/serviceAuth.ts`, `src/lib/gcs.ts`
- `src/app/(dashboard)/admin/content/`, `src/app/(dashboard)/admin/agents/`
- `src/app/api/content/`, `src/app/api/agents/`, `src/app/api/admin/content/`,
  `src/app/api/admin/agents/`
