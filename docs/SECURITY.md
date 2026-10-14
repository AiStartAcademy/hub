# Security Architecture

How the hub authenticates people and machines, authorizes actions, verifies webhooks, and
handles personal and payment data. This is the design reference for contributors. To report a
vulnerability, follow the policy in the root [SECURITY.md](../SECURITY.md) instead of opening a
public issue.

The hub holds student and lead PII, call recordings, and takes payments. Treat every change to
an API route, webhook, or machine endpoint as security-relevant.

## People: authentication

- **Auth.js / NextAuth v5** (`next-auth@5` beta, pinned) with **JWT sessions**. Config:
  [`src/lib/auth.ts`](../src/lib/auth.ts).
- Providers: **Google OAuth** (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and
  **email/password credentials**, hashed with `bcryptjs`. Password rules live in
  `src/lib/password.ts`.
- Email verification is tracked (`User.emailVerified`) and offered from Settings, but is not
  required to sign in.
- Guest buyers (Stripe checkout without an account) get an account-setup link; tokens are in
  `src/lib/tokens.ts`.
- `AUTH_SECRET` signs sessions. Use a unique random value per environment.

## People: authorization

- Roles: `STUDENT`, `EVENT_ORGANIZER`, `TEAM_MEMBER`, `INSTRUCTOR`, `ADMIN`
  (`ROLE_VALUES` in [`src/lib/roles.ts`](../src/lib/roles.ts)). A user can hold several;
  `User.roles` (JSON array) is the source of truth and `User.role` is a legacy primary role.
  Use `hasRole` / `hasAnyRole` / `getRoles`, never string comparisons on `role`.
  See [features/USER_ROLES.md](./features/USER_ROLES.md).
- Role sets: `ADMIN_ROLES = [ADMIN]`; `MANAGE_ROLES` / `STAFF_ROLES = [TEAM_MEMBER, INSTRUCTOR, ADMIN]`;
  CRM staff (`CRM_STAFF_ROLES` in `src/lib/adminGuard.ts`) = `ADMIN`, `TEAM_MEMBER`.
  `assertStaff()` and `assertAdmin()` guard server actions and routes.
- There is no global middleware. Every page and route handler calls `auth()` and checks roles
  itself. **Re-check the role inside each API route**; hiding a button is not authorization.
- Course content access is decided by `checkProgramAccess()` in `src/lib/programAccess.ts`
  (enrollment, entitlements, membership tiers). When `CONSENT_GATE_ENABLED=true`, the same path
  also requires acceptance of the legal documents (`src/lib/consent.ts`).
- The `(dashboard)` layout sets `robots: noindex`. Pages meant to be public and indexable
  override metadata in a server `page.tsx` (see [CONVENTIONS.md](./CONVENTIONS.md)).
- Audience-specific projections (what a guest vs a student vs staff may see of an object) are
  built server-side; see [features/VIEWS.md](./features/VIEWS.md).

## Machines: bearer tokens

Machine-to-machine routes never accept a session alone. They use
[`src/lib/serviceAuth.ts`](../src/lib/serviceAuth.ts):

- `requireServiceToken(req, NAME)` reads the expected token from `process.env[NAME]`;
  `requireManagedServiceToken(req, NAME)` resolves it through the Integrations store with env
  fallback, so it can be rotated without a redeploy.
- Both **fail closed**: an unset token returns 500 and the request is refused. Comparison is
  constant-time over SHA-256 digests.
- Use one dedicated token per caller. Never reuse a token across services.

| Routes | Token |
|--------|-------|
| `/api/internal/mcp/*` | `HUB_MCP_TOKEN` (managed) |
| `/api/internal/drip/tick`, `/api/internal/instructor/tick` | `DRIP_CRON_TOKEN` (managed) |
| `/api/content/ingest`, `/api/content/claim`, `/api/content/media` | `CONTENT_INGEST_TOKEN` |
| `/api/content/published` | `SITE_BUILD_TOKEN` |
| `/api/agents/[slug]/status`, `/api/agents/runs/[id]` (POST) | `AGENT_REPORT_TOKEN` |
| `/api/n8n/module-callback`, `/api/n8n/extract-audio-callback` | `N8N_WEBHOOK_SECRET` |
| `/api/n8n/callback` | `N8N_CALLBACK_SECRET` |

### MCP API

The MCP API has two independent controls: the bearer token gates every route, and
`HUB_MCP_WRITES_ENABLED` (exactly `true`) gates every write. Responses are `private, no-store`,
field-allowlisted, paginated (max 100) and size-capped (64 KiB lists, 256 KiB detail). Errors
return generic messages. Never add auth tokens, password hashes, or payment credentials to a
projection. See [MCP_API.md](./MCP_API.md).

## Webhooks: signature verification

Never process an unverified webhook body.

| Webhook | Verification |
|---------|-------------|
| `/api/webhooks/stripe` | `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`. |
| `/api/webhooks/twilio/**` | `twilio.validateRequest` over `x-twilio-signature` and the form params, with `TWILIO_AUTH_TOKEN` (`src/lib/twilio/verify.ts`). The signed URL is rebuilt from `NEXT_PUBLIC_APP_URL`, so behind a proxy it must match the public origin exactly. Missing auth token = 500, missing signature = 401. |
| `/api/webhooks/vapi` | Timing-safe compare of the `x-vapi-secret` header with `VAPI_WEBHOOK_SECRET`. |
| `/api/webhooks/zoom` | `x-zm-signature` HMAC with `ZOOM_WEBHOOK_SECRET` (`src/lib/zoomWebhookSignature.ts`), plus the `endpoint.url_validation` challenge. |

## Public surfaces

Intentionally logged-out routes include onboarding quizzes (`/onboarding/[slug]`), the public
catalog and cohort pages, `/events`, `/calendar`, `/humans/[slug]`, agreement signing
(`/agreements/[token]`), booking (`/book/[token]`), `/unsubscribe`, legal pages, and the
`/api/public/*` routes. Rules for these:

- Token-addressed pages (agreements, bookings, instructor responses, account setup) rely on
  unguessable tokens; never expose a token in a listing.
- Public form endpoints use the in-process limiter in `src/lib/rateLimit.ts`. It is per process,
  which is correct for the supported single-instance deployment; move it to a shared store
  before running more than one instance.
- User-authored rich text rendered publicly passes through `sanitize-html` allowlists
  (`src/lib/sanitize.ts`, `src/lib/onboarding-security.ts`).
- Guest checkout must keep server-side validation: a logged-out caller must never be able to
  grant themselves access without a verified Stripe payment.

## Email tracking

Open and click tracking (`/api/e/o/[token]`, `/api/e/c/[token]`) uses stateless HMAC-signed
tokens (`DRIP_TRACKING_SECRET`). The click destination is inside the signed payload, so the
redirect cannot be abused as an open redirect. IPs are stored only as salted hashes. See
[features/EMAIL_TRACKING.md](./features/EMAIL_TRACKING.md).

## Secrets

- No secrets in the repository. `.env.example` holds placeholders only; keep it complete when
  you add a variable.
- Secrets saved in Admin → Integrations are encrypted with AES-256-GCM under
  `SETTINGS_ENC_KEY` (`src/lib/secretsCrypto.ts`); changes are recorded in `SecretAudit`. The
  admin API returns only the last four characters of a `secret`-kind value (`config`-kind
  values are returned in full, so never store a credential as `config`).
- `docker-compose.yml` is a development convenience; do not reuse it with real credentials.

## Data handling

- **PII**: users, lead `Contact`s, onboarding answers, attribution, call recordings and
  transcripts. Do not log PII. Never put PII in URLs or query strings, including form answers.
- **Consent**: `Contact` keeps marketing email (`unsubscribedAt`), course email
  (`courseEmailOptOutAt`), marketing SMS, transactional SMS, phone consent and `doNotCall` as
  separate fields. Honor them in every new send path. SMS `STOP`-style keywords are handled in
  `src/lib/sms/keywords.ts`; email opt-out is `/unsubscribe`.
- **Payments**: Stripe holds card data. The hub stores `Payment`, `Membership`, `Enrollment`
  rows and Stripe ids only.
- **Media**: serve protected files through the access-checked routes (e.g. `/api/download/[id]`,
  `/api/twilio/recordings/[sid]`), not raw bucket URLs.

## Must not

- Expose an `/api/admin/*`, `/api/internal/*` or machine route without its role or token check.
- Disable or weaken webhook signature verification.
- Return secrets, tokens, or password hashes from any API.
- Commit a real secret, real personal data, or a production database.
