# Integrations (secrets and config registry)

An admin-managed store for API keys, tokens, service endpoints, and feature flags, so they can
be set and rotated from the admin UI instead of redeploying with new environment variables.
Values are read server-side through one accessor, `getSecret()`, with the process environment
as the fallback.

## Data model (`prisma/schema.prisma`)

`Secret` holds one row per managed key. There are two kinds:

| kind | Typical use | Storage | Shown in the UI as |
|------|-------------|---------|--------------------|
| `secret` | API keys, tokens, webhook secrets | AES-256-GCM ciphertext (`valueEncrypted`, `iv`, `authTag`, all base64) | write-only; `last4` only |
| `config` | URLs, IDs, flags | plaintext in `valuePlain` | full value, editable |

Other columns: `key` (unique, `UPPER_SNAKE_CASE`), `category`
(`llm | mcp | payments | comms | marketing | endpoints | other`), `description`, `updatedBy`
(a `User.id`), `createdAt`, `updatedAt`.

`SecretAudit` records `key`, `action` (`create | update | delete`), `actorId`, and `createdAt`
for every change. It never stores the value.

## Encryption (`src/lib/secretsCrypto.ts`)

- Algorithm: AES-256-GCM with a random 12-byte IV per encryption and a stored auth tag.
- Key: `SETTINGS_ENC_KEY` in the environment. It must decode to exactly **32 bytes**. Two
  formats are accepted: a 64-character hex string, or base64 (preferred). Generate one with
  `openssl rand -base64 32`.
- Fails closed. A missing, malformed, or wrong-length key throws, so the registry never falls
  back to plaintext. `secretsCryptoReady()` reports whether the key is usable. The admin API
  returns it as `cryptoReady`, and refuses to save a `secret`-kind value (HTTP 500) while it is
  false.
- Exports: `encryptSecret(plain)`, `decryptSecret({ valueEncrypted, iv, authTag })`,
  `secretsCryptoReady()`, `last4(value)`.
- Rotating `SETTINGS_ENC_KEY` makes every stored secret undecryptable. No re-encryption tool
  ships with the hub, so treat the key as stable and back it up with your database backups.

## Resolution order (`src/lib/secrets.ts`)

```
getSecret(key)  ->  DB Secret row (decrypted if kind = secret)  ->  process.env[key]  ->  undefined
```

- Results are cached in-process for **30 seconds** per key. Saving or deleting a key through the
  admin API calls `bustSecretCache(key)`, but only in the process that served the request. With
  several replicas, the others pick up the change when their cache expires.
- A row that exists but cannot be decrypted (wrong key, corrupt data) throws. It is not
  treated as missing.
- Deleting a row brings back the environment value.
- Machine-token routes that admins rotate from this UI use
  `requireManagedServiceToken(req, key)` (`src/lib/serviceAuth.ts`). It resolves the expected
  bearer through `getSecret()`. `HUB_MCP_TOKEN` and `DRIP_CRON_TOKEN` are checked this way.
  `requireServiceToken()` reads only `process.env`.
- Bootstrap values stay env-only by design: `SETTINGS_ENC_KEY`, `DATABASE_URL`,
  `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` are read directly from `process.env`. See
  [../ENVIRONMENT.md](../ENVIRONMENT.md).

## Admin UI: `/admin/integrations`

- **ADMIN only.** This is stricter than most admin pages, which also admit `TEAM_MEMBER`. The
  page redirects anyone else to `/dashboard`, and every API call re-checks the role on the
  server.
- Rows are grouped by category. Secret rows show `last4` and cannot be revealed. Config rows
  show and edit their value inline.
- The add form suggests every key in `knownKeys.ts` (below) and fills in its kind, category,
  and description. A custom `UPPER_SNAKE_CASE` key can also be entered. `getSecret()` resolves
  any key, but a value only takes effect if some code path reads that key through
  `getSecret()`.

## API (session auth, ADMIN, `Cache-Control: private, no-store`)

| Method | Route | Behavior |
|--------|-------|----------|
| `GET` | `/api/admin/integrations` | Lists rows plus `cryptoReady`. Secrets return `last4` and `isSet`, never plaintext. |
| `PUT` | `/api/admin/integrations` | Body `{ key, kind, category?, value, description? }`. Upserts the row, writes a `SecretAudit` row, and busts the cache. |
| `DELETE` | `/api/admin/integrations?key=NAME` | Removes the row (the env value applies again) and writes an audit row. |

No route ever sends a decrypted secret to a client.

Save-time validation (`src/lib/integrations/validateIntegrationValue.ts`):
- `INBOUND_ROUTE_CHAIN` must be a non-empty JSON array of unique, known steps.
- `CLOSER_RING_STRATEGY` must be `simulring` or `round-robin`.
- `INBOUND_FORWARD_NUMBER` and `VAPI_INBOUND_NUMBER` must be valid phone numbers, and neither
  may equal `TWILIO_PHONE_NUMBER`. That would create a call loop.

## Known keys (`src/app/(dashboard)/admin/integrations/knownKeys.ts`)

| Key | Kind | Purpose |
|-----|------|---------|
| `N8N_EXTRACT_AUDIO_WEBHOOK_URL` | config | n8n webhook that extracts audio from a lesson video and calls back to `/api/n8n/extract-audio-callback` |
| `N8N_WEBHOOK_URL` | config | Course-ingestion workflow trigger |
| `N8N_WEBHOOK_SECRET` | secret | Bearer token n8n presents on inbound callbacks (module and extract-audio callbacks) |
| `N8N_CALLBACK_SECRET` | secret | Secret for the legacy `/api/n8n/callback` route |
| `OPENAI_API_KEY` | secret | Image generation and program cover generation |
| `META_PIXEL_ID` | config | Meta dataset ID for the browser pixel (served via `/api/meta-pixel`) and server CAPI events |
| `META_CAPI_TOKEN` | secret | Meta Conversions API access token (server-side Lead and Purchase events) |
| `META_TEST_EVENT_CODE` | config | Sends CAPI events to Meta Test Events. Delete it after testing, because events stay out of live reporting while it is set. |
| `GA4_MEASUREMENT_ID` | config | GA4 stream ID for server-side Measurement Protocol conversions |
| `GA4_API_SECRET` | secret | GA4 Measurement Protocol API secret |
| `DRIP_TRACKING_SECRET` | secret | Signs email open/click tracking. While it is unset, emails still send but are not tracked. |
| `EXTRACT_AUDIO_SERVICE_URL` | config | Audio-extractor service endpoint that n8n calls (for example `http://<service>.<namespace>.svc.cluster.local/extract-audio-gcs`) |
| `HUB_INTERNAL_URL` | config | Server-only hub base URL for internal callbacks, so in-cluster callers don't need the public hostname |
| `TWILIO_ACCOUNT_SID` | config | Twilio account for messaging, voice tokens, and recordings |
| `TWILIO_AUTH_TOKEN` | secret | Twilio API credential, also used to verify webhook signatures |
| `TWILIO_PHONE_NUMBER` | config | E.164 Twilio number for sending and for inbound routing |
| `TWILIO_API_KEY_SID` | config | API key ID for minting browser softphone tokens |
| `TWILIO_API_KEY_SECRET` | secret | API key secret for signing softphone tokens |
| `TWILIO_TWIML_APP_SID` | config | TwiML app assigned to softphone voice grants |
| `VAPI_API_KEY` | secret | Vapi private key for outbound AI calls |
| `VAPI_PHONE_NUMBER_ID` | config | Vapi phone-number resource used for outbound calls |
| `VAPI_DEFAULT_ASSISTANT_ID` | config | Default Vapi assistant when a call has no override |
| `VAPI_WEBHOOK_SECRET` | secret | Required in the `x-vapi-secret` header on inbound Vapi webhooks |
| `INBOUND_ROUTE_CHAIN` | config | Ordered JSON array of inbound routing steps, for example `["owner","closers","vapi","forward"]` |
| `CLOSER_RING_STRATEGY` | config | `simulring` or `round-robin` |
| `INBOUND_FORWARD_NUMBER` | config | E.164 fallback destination for inbound calls; must differ from `TWILIO_PHONE_NUMBER` |
| `VAPI_INBOUND_NUMBER` | config | E.164 Vapi destination in the inbound chain; must differ from `TWILIO_PHONE_NUMBER` |
| `SMS_TRANSACTIONAL_ENABLED` | config | Set it to `true` once your A2P campaign is approved, so cohort messages send their SMS step. Any other value sends email only. |

Other keys are also read through `getSecret()` but have no UI suggestion. They work if you add
them by name. Examples: `HUB_MCP_TOKEN`, `HUB_MCP_WRITES_ENABLED`, `DRIP_CRON_TOKEN`,
`OPENROUTER_API_KEY`, `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`,
`MAIL_FROM`, `DRIP_EMAIL_FROM`, `ZOOM_HOST_EMAIL`, `STRIPE_MEMBERSHIP_RECORDINGS_PRICE_ID`,
and `STRIPE_MEMBERSHIP_ACCELERATOR_PRICE_ID`.

## Caveat: client-side tokens

The registry is where the hub checks and rotates `HUB_MCP_TOKEN`. Callers, such as the companion MCP server described in [../MCP_API.md](../MCP_API.md), still
hold their own copy. To rotate it, save the new value here,
then update the caller's environment. See [../MCP_API.md](../MCP_API.md) and
[../SECURITY.md](../SECURITY.md).

## Tests

`bun test tests/unit` runs two relevant suites:
- `tests/unit/secretsCrypto.test.ts`: round-trip, a fresh IV each time, tamper detection,
  fail-closed on a missing or wrong-length key, and `last4`.
- `tests/unit/integration-routing-keys.test.ts`: validation of the inbound routing keys.
