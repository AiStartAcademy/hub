# Environment Variables

Every environment variable the hub reads, grouped by integration. Only the **Core** group is
required to boot. Every other group switches on one feature; leave it blank and that feature
stays inactive.

The committed template is [`.env.example`](../.env.example). Copy it to `.env` for local work
(`.env*` is gitignored except the template). Never commit a real value.

## Two places a value can live

1. **Process environment** (`.env` locally, your platform's secret store in production).
2. **Admin → Integrations** (`/admin/integrations`). Values saved there are stored in the
   `Secret` table and resolved by `getSecret()` in `src/lib/secrets.ts` with this order:
   database value (decrypted for `secret` kind) → `process.env[key]` → unset. Results are
   cached in-process for 30 seconds. Saving a `secret`-kind value requires `SETTINGS_ENC_KEY`.
   See [features/INTEGRATIONS.md](./features/INTEGRATIONS.md).

The **M** column below marks keys resolved through `getSecret()`, which you may set in either
place (the Integrations value wins). Keys without **M** are read from `process.env` only.
`NEXT_PUBLIC_*` keys are inlined into the client bundle at build time, so set them before
`npm run build`.

## Core (required to boot)

| Variable | M | Purpose |
|----------|---|---------|
| `DATABASE_URL` | | SQLite path, e.g. `file:/abs/path/prisma/dev.db`. Use an absolute path. |
| `AUTH_SECRET` | | Auth.js (NextAuth v5) signing secret. Generate with `openssl rand -hex 32`. |
| `NEXTAUTH_SECRET` | | Same value as `AUTH_SECRET` (read by older call sites). |
| `NEXTAUTH_URL` | | Base URL for auth callbacks, e.g. `http://localhost:3000`. |
| `NEXT_PUBLIC_APP_URL` | | Public origin of the hub. Used in emails, canonical URLs, tracking links, and Twilio signature validation (must match the externally visible scheme and host exactly). |
| `NODE_ENV` | | `development` locally, `production` in the container. |
| `HUB_INTERNAL_URL` | M | Optional server-only base URL for internal callbacks (e.g. audio extraction), so backend-to-backend traffic need not use the public host. Falls back to `NEXT_PUBLIC_APP_URL`. |

## Integrations store

| Variable | M | Purpose |
|----------|---|---------|
| `SETTINGS_ENC_KEY` | | 32-byte AES key for `secret`-kind values in the Integrations store. Base64 (preferred) or 64-char hex. Generate with `openssl rand -base64 32`. Without it, reading or saving encrypted Integrations values fails; env fallbacks still work. Rotating it makes existing encrypted values undecryptable. |

## Brand and catalog overrides

All academy names, domains, contact details and copy live in
[`src/config/brand.ts`](../src/config/brand.ts) — that is code, not env. These optional overrides
are read by `src/config/catalog.ts` and the telemetry provider:

| Variable | M | Purpose |
|----------|---|---------|
| `NEXT_PUBLIC_SELF_PACED_PROGRAM_ID` | | Program id sold on `/self-paced`. Empty = no self-paced product. |
| `NEXT_PUBLIC_QA_EVENT_COHORT_ID` | | Cohort id of a free live Q&A session linked from nurture emails. |
| `NEXT_PUBLIC_GTM_ID` | | Google Tag Manager container (`GTM-XXXXXXX`). Empty = no GTM. |
| `NEXT_PUBLIC_TELEMETRY_URL` | | Grafana Faro collector URL. Unset = `brand.urls.telemetryCollector` in production builds (empty disables browser telemetry), `http://localhost:3100/collect` in dev. |
| `NEXT_PUBLIC_APP_ENV` / `NEXT_PUBLIC_NODE_ENV` | | Environment label attached to browser telemetry. |
| `HUB_DOMAIN` | | Public hostname for the `docker-compose.yml` Caddy proxy. Required by compose only. |

## Logging

| Variable | M | Purpose |
|----------|---|---------|
| `APP_ENV` | | Overrides `NODE_ENV` for log routing. `development`/`local` = pretty console logs; anything else = Loki + file transports. |
| `LOG_LEVEL` | | Pino level. Default `debug` locally, `info` otherwise. |
| `LOG_FILE_PATH` | | Log file for non-local environments. Default `/app/logs/lms.log`; skipped if the directory is not writable. |
| `ALLOY_HOST` | | Loki/Alloy push endpoint for server logs. Default `http://localhost:3101`. |

## Stripe (seats, memberships, guest checkout, venue rental links)

Checkout is hosted by Stripe; the hub never touches card data. Seat prices are built from
`Group.price`. Access is granted by the webhook, never by the browser redirect. See
[features/PAYMENTS.md](./features/PAYMENTS.md).

| Variable | M | Purpose |
|----------|---|---------|
| `STRIPE_SECRET_KEY` | | Server-side Stripe API key (`sk_test_…` / `sk_live_…`). |
| `STRIPE_WEBHOOK_SECRET` | | Signing secret of the endpoint `/api/webhooks/stripe` (`whsec_…`). The Stripe CLI and each dashboard endpoint have different values. |
| `STRIPE_MEMBERSHIP_RECORDINGS_PRICE_ID` | M | Optional pre-created recurring Price for the recordings membership tier. Unset = price built inline. |
| `STRIPE_MEMBERSHIP_ACCELERATOR_PRICE_ID` | M | Same, for the accelerator tier. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | | Listed in `.env.example`; not currently read by `src/` (checkout is hosted). |

## Authentication: Google sign-in

| Variable | M | Purpose |
|----------|---|---------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | | "Continue with Google". Email/password login works without them. |

## Google Cloud Storage (media library, uploads, covers)

| Variable | M | Purpose |
|----------|---|---------|
| `GCS_PROJECT_ID` | | GCP project. |
| `GCS_CLIENT_EMAIL` / `GCS_PRIVATE_KEY` | | Service-account credentials. |
| `GCS_BUCKET_NAME` | | Media bucket (server). |
| `NEXT_PUBLIC_GCS_BUCKET_NAME` | | Media bucket name used to build public URLs in the client. |

`next.config.ts` restricts `next/image` remote images to a single `storage.googleapis.com`
bucket path; change `images.remotePatterns` to your bucket.

## Google Drive (course import)

| Variable | M | Purpose |
|----------|---|---------|
| `GOOGLE_DRIVE_CLIENT_EMAIL` / `GOOGLE_DRIVE_PRIVATE_KEY` | | Service account used to read Drive folders during import. |
| `NEXT_PUBLIC_GOOGLE_API_KEY` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | | Browser Drive picker (`src/components/GoogleDrivePicker.tsx`). |

## Google Calendar (instructor schedules, lead bookings, venue events)

All five must be set or calendar sync is skipped (`src/lib/googleCalendar.ts`). A refresh token
for a real organizer mailbox is used because a bare service account cannot invite external
attendees without domain-wide delegation.

| Variable | M | Purpose |
|----------|---|---------|
| `GOOGLE_CALENDAR_ID` | | Target calendar. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | | OAuth client that minted the refresh token. |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | | Offline refresh token for the organizer mailbox. |
| `GOOGLE_CALENDAR_ORGANIZER_EMAIL` | | Organizer address added to events. |

## Zoom (cohort meetings, recordings import)

| Variable | M | Purpose |
|----------|---|---------|
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | | Server-to-Server OAuth app. |
| `ZOOM_WEBHOOK_SECRET` | | Secret token used to verify `x-zm-signature` on `/api/webhooks/zoom` and answer URL validation. |
| `ZOOM_HOST_EMAIL` | M | Zoom user that hosts created meetings. Default `me` (the app's account owner). |

## Email (SMTP)

| Variable | M | Purpose |
|----------|---|---------|
| `SMTP_HOST` | M | SMTP server. Unset = mail is not configured and sends are skipped. |
| `SMTP_PORT` | M | Default `587`. Port `465` implies implicit TLS. |
| `SMTP_SECURE` | M | `true` forces implicit TLS. |
| `SMTP_USER` / `SMTP_PASS` | M | SMTP auth. |
| `MAIL_FROM` | M | From address; bare address or `"Name" <addr>`. |
| `DRIP_EMAIL_FROM` | M | Optional From/Reply-To for drip and broadcast mail. |
| `REPORT_ISSUE_EMAIL` | | Destination for the in-app "Report issue" form. |
| `INTERNAL_NOTIFICATION_EMAIL` | | Staff inbox for venue requests and signed agreements. Default `brand.email.contact`. |

Instructor outreach mail also accepts an optional From and Reply-To override from the
environment; see `src/lib/instructorOutreach.ts` for the variable names.

## Drip runner and email tracking

| Variable | M | Purpose |
|----------|---|---------|
| `DRIP_CRON_TOKEN` | M | Bearer token for `/api/internal/drip/tick` and `/api/internal/instructor/tick`. Missing = both routes return 500. |
| `DRIP_TRACKING_SECRET` | M | HMAC key for open-pixel and click-redirect tokens. Unset = mail goes out untracked. Rotating it breaks tracking links in delivered mail. |
| `DRIP_TRACKING_SALT` | M | Optional separate salt for hashed IPs on tracking events. Falls back to `DRIP_TRACKING_SECRET`. |

## SMS and voice (Twilio)

| Variable | M | Purpose |
|----------|---|---------|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | M | API client and webhook signature verification. Without the auth token every Twilio webhook is refused. |
| `TWILIO_PHONE_NUMBER` | M | E.164 number for outbound SMS and inbound calls. |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | M | Signs browser softphone access tokens. |
| `TWILIO_TWIML_APP_SID` | M | TwiML app attached to softphone voice grants. |
| `SMS_TRANSACTIONAL_ENABLED` | M | `true` lets cohort messages send their SMS step; anything else sends email only. |
| `SMS_OPTIN_CONFIRMATION_ENABLED` | M | `true` sends an opt-in confirmation SMS after consent. |
| `INBOUND_ROUTE_CHAIN` | M | JSON array of inbound call steps, e.g. `["owner","closers","vapi","forward"]`. |
| `CLOSER_RING_STRATEGY` | M | How available closers are rung (e.g. `simulring`). |
| `INBOUND_FORWARD_NUMBER` | M | E.164 fallback destination. Must never equal `TWILIO_PHONE_NUMBER` (call loop). |
| `BOOKING_DEFAULT_CLOSER_ID` | M | User id whose availability backs default booking links. |

## Voice AI (Vapi)

| Variable | M | Purpose |
|----------|---|---------|
| `VAPI_API_KEY` | M | Places outbound AI calls. |
| `VAPI_PHONE_NUMBER_ID` | M | Vapi phone-number resource for outbound calls. |
| `VAPI_DEFAULT_ASSISTANT_ID` | M | Default assistant when a call has no override. |
| `VAPI_WEBHOOK_SECRET` | M | Compared (timing-safe) with the `x-vapi-secret` header on `/api/webhooks/vapi`. |
| `VAPI_INBOUND_NUMBER` | M | E.164 Vapi destination in the inbound chain. Must never equal `TWILIO_PHONE_NUMBER`. |

See [features/VAPI_RECEPTIONIST.md](./features/VAPI_RECEPTIONIST.md).

## Chat (Rocket.Chat)

| Variable | M | Purpose |
|----------|---|---------|
| `RC_URL` | | Rocket.Chat base URL. |
| `RC_ADMIN_USER_ID` / `RC_ADMIN_AUTH_TOKEN` | | Admin REST credentials. |
| `RC_PASSWORD_SECRET` | | Secret used to derive deterministic per-user chat passwords. |

## AI

| Variable | M | Purpose |
|----------|---|---------|
| `OPENROUTER_API_KEY` | M | LLM calls through `src/lib/inference.ts` (onboarding analysis, lead briefs, email drafts). |
| `OPENAI_API_KEY` | M | Image generation (`/api/generate-image`, program covers). |
| `AI_MODEL_LEAD_BRIEF` / `AI_MODEL_EMAIL_DRAFT` | M | Optional per-feature model override (`src/lib/ai/features.ts`); default `google/gemini-2.5-flash`. Usually set from `/admin/billing`. |

## Server-side conversions (GA4 Measurement Protocol, Meta Conversions API)

Each destination is independent; leave a pair blank and only that one goes quiet.

| Variable | M | Purpose |
|----------|---|---------|
| `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` | M | GA4 stream id (`G-XXXXXXXXXX`) and Measurement Protocol secret. |
| `META_PIXEL_ID` | M | Drives both the browser pixel (served via `/api/meta-pixel`) and server events. |
| `META_CAPI_TOKEN` | M | Conversions API access token. |
| `META_TEST_EVENT_CODE` | M | Routes events to Test Events. Leave blank in production. |

See [features/ANALYTICS_SEO.md](./features/ANALYTICS_SEO.md).

## n8n (course ingestion, audio extraction)

| Variable | M | Purpose |
|----------|---|---------|
| `N8N_WEBHOOK_URL` | | Course-ingestion workflow trigger. |
| `N8N_EXTRACT_AUDIO_WEBHOOK_URL` | M | Workflow that extracts lesson audio and calls back to `/api/n8n/extract-audio-callback`. |
| `N8N_WEBHOOK_SECRET` | | Bearer n8n presents on `/api/n8n/module-callback` and `/api/n8n/extract-audio-callback`. |
| `N8N_CALLBACK_SECRET` | | Bearer n8n presents on `/api/n8n/callback`. Set it whenever n8n is in use. |
| `EXTRACT_AUDIO_SERVICE_URL` | M | Registered in the Integrations catalog for your n8n workflow to read; the hub itself does not call it. |

## Content platform and agents service

| Variable | M | Purpose |
|----------|---|---------|
| `CONTENT_INGEST_TOKEN` | | Bearer for `/api/content/ingest`, `/api/content/claim`, `/api/content/media`. |
| `SITE_BUILD_TOKEN` | | Bearer your static-site build uses on `/api/content/published`. |
| `SITE_BUILD_TRIGGER_URL` / `SITE_BUILD_TRIGGER_TOKEN` | | Optional webhook the hub calls to rebuild your site after publishing. |
| `AGENTS_SERVICE_URL` / `AGENTS_SERVICE_TOKEN` | | External agents service the admin "Agents" page dispatches runs to. |
| `AGENT_REPORT_TOKEN` | | Bearer the agents service uses to report run status back. |

See [features/CONTENT_CMS.md](./features/CONTENT_CMS.md).

## MCP API

| Variable | M | Purpose |
|----------|---|---------|
| `HUB_MCP_TOKEN` | M | Dedicated bearer for `/api/internal/mcp/*`. Missing = every MCP route fails closed. |
| `HUB_MCP_WRITES_ENABLED` | M | Authoritative write switch. Only the exact string `true` enables writes. |
| `HUB_ENV` | | Environment label returned by the MCP health endpoint. |

See [MCP_API.md](./MCP_API.md).

## Feature flags and misc

| Variable | M | Purpose |
|----------|---|---------|
| `CONSENT_GATE_ENABLED` | | `true` enforces legal-document acceptance before paid course content (`src/lib/consent.ts`). Acceptances are recorded either way. |
| `COHORT_DEFAULT_PROGRAM_TITLES` | M | Comma-separated program names linked to every cohort created through the MCP API. |
| `PUPPETEER_EXECUTABLE_PATH` | | Chromium used for PDF rendering. Set by the Dockerfile. |

## Legacy CRM (GoHighLevel, optional)

The internal Leads CRM is the primary lead store. A GoHighLevel sync remains in `src/lib/ghl.ts`
and runs only when these are set: `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_UTM_SOURCE_ID`,
`GHL_UTM_MEDIUM_ID`, `GHL_UTM_CAMPAIGN_ID`, `GHL_UTM_CONTENT_ID`.

## Script-only variables

`scripts/call-transcripts/` reads `HUB_URL` and `HUB_MCP_TOKEN` to talk to a running hub. See
[features/CALL_TRANSCRIPTS.md](./features/CALL_TRANSCRIPTS.md).
