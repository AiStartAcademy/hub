# Deployment

The hub is a single Next.js process with an SQLite database file. Self-hosting it means: build
the image, give it a persistent volume for the database, set the environment, apply the Prisma
schema on start, configure provider webhooks, and run two cron calls.

## 1. Build the image

The [`Dockerfile`](../Dockerfile) is a three-stage build on `node:20-alpine`:

- **deps** installs `node_modules` with npm plus system Chromium, Ghostscript and fonts
  (Puppeteer uses the system Chromium for certificate and agreement PDFs;
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`).
- **builder** runs `npx prisma generate` and `npm run build` (`output: "standalone"` in
  `next.config.ts`).
- **runner** copies `.next/standalone`, `.next/static`, `public/` and `prisma/`, installs the
  Prisma 6 CLI, runs as the unprivileged `nextjs` user on port `3000`, and starts with
  `CMD ["sh", "/app/start.sh"]`.

```bash
docker build -t hub .
```

`NEXT_PUBLIC_*` variables are inlined at build time. Pass the ones you need as build-time
environment (for example by adding `ARG`/`ENV` lines) or they will be empty in the browser.

## 2. Start script

The runner's `CMD` executes [`start.sh`](../start.sh), which applies `prisma/schema.prisma` to the
database (`prisma db push --skip-generate`, using the Prisma 6 CLI pinned in the image) and then
starts the standalone server. It exits early if `DATABASE_URL` is unset.

The project uses `prisma db push`, not migration files, so applying the schema on every start is
how schema changes reach the database. Additive changes are safe. Dropping or narrowing a column
can lose data, and `db push` refuses such changes unless you pass `--accept-data-loss`; review the
schema diff before deploying with that flag.

A minimal run:

```bash
docker run -d -p 3000:3000 -v hub-data:/app/data \
  -e DATABASE_URL=file:/app/data/hub.db \
  -e AUTH_SECRET="$(openssl rand -hex 32)" -e AUTH_TRUST_HOST=true \
  -e NEXTAUTH_URL=https://hub.example.com \
  hub
```

## 3. Persist the database

`DATABASE_URL` points at an SQLite file. Put that file on a persistent volume, for example
`DATABASE_URL="file:/app/data/hub.db"` with a volume mounted at `/app/data` and writable by
UID 1001. Without a volume every restart starts from an empty database.

- Run exactly **one** replica. SQLite is a single-writer file; do not share it across hosts.
- Back up the file regularly (for example `sqlite3 hub.db ".backup hub-backup.db"`; the runner
  image includes `sqlite`).
- Server logs go to `LOG_FILE_PATH` (default `/app/logs/lms.log`) when the directory is
  writable, and to a Loki endpoint at `ALLOY_HOST`. See [ENVIRONMENT.md](./ENVIRONMENT.md).

## 4. Environment

Set the Core group and whichever integrations you use; see [ENVIRONMENT.md](./ENVIRONMENT.md).
In production at minimum:

- `NODE_ENV=production`, a strong `AUTH_SECRET` / `NEXTAUTH_SECRET`.
- `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` set to the public origin, e.g.
  `https://hub.example.com`. Twilio signature checks rebuild the signed URL from
  `NEXT_PUBLIC_APP_URL`, so it must match the externally visible scheme and host exactly.
- `SETTINGS_ENC_KEY` if you want to manage secrets from Admin → Integrations.

Keep secrets in your platform's secret store, never in the image or a committed file.

## 5. TLS and reverse proxy

Terminate TLS in front of the container. [`docker-compose.yml`](../docker-compose.yml) shows one
option: a Caddy proxy (`caddy reverse-proxy --from $HUB_DOMAIN --to hub-app:3000`) with
automatic HTTPS. Note that the compose file's `hub-app` service builds only the `deps` stage and
runs the **dev** server (`npm run dev`) with the source tree mounted; it is a convenience for
container parity, not a production setup. For production, run the full image from step 1 behind
the proxy.

## 6. Provider webhooks

Configure each provider you enable to call the hub. All of these verify the caller and reject
unsigned requests; see [SECURITY.md](./SECURITY.md).

| Provider | URL | Verification | Notes |
|----------|-----|--------------|-------|
| Stripe | `https://hub.example.com/api/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` signature | Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `customer.subscription.updated`, `customer.subscription.deleted`. Test and live mode endpoints have different secrets. The webhook is the only path that grants paid access. |
| Zoom | `https://hub.example.com/api/webhooks/zoom` | `ZOOM_WEBHOOK_SECRET` (`x-zm-signature`, URL validation) | Subscribe to `recording.completed` to import cloud recordings as lessons. |
| Twilio (messaging) | `https://hub.example.com/api/webhooks/twilio/sms` | `TWILIO_AUTH_TOKEN` (`x-twilio-signature`) | Set as the number's incoming-message webhook. Status callbacks (`/sms/status`) are set per message by the hub. |
| Twilio (incoming voice) | `https://hub.example.com/api/webhooks/twilio/voice/inbound` | `TWILIO_AUTH_TOKEN` | Set as the number's incoming-call webhook; walks `INBOUND_ROUTE_CHAIN`. |
| Twilio (softphone) | `https://hub.example.com/api/webhooks/twilio/voice` | `TWILIO_AUTH_TOKEN` | Set as the Voice URL of the TwiML app in `TWILIO_TWIML_APP_SID`. Recording, transcription and status callbacks are set by the hub. |
| Vapi | `https://hub.example.com/api/webhooks/vapi` | `x-vapi-secret` header equals `VAPI_WEBHOOK_SECRET` | Set as the assistant/phone number server URL. |
| n8n | `/api/n8n/module-callback`, `/api/n8n/extract-audio-callback`, `/api/n8n/callback` | Bearer `N8N_WEBHOOK_SECRET` / `N8N_CALLBACK_SECRET` | Only if you run the n8n workflows. |

For local Stripe testing:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## 7. Scheduled jobs

Two runners must be called on a schedule. Every 15 minutes is the intended cadence; both are
safe to call more often or concurrently (unique send rows prevent double sends).

```bash
# Drip campaigns, broadcasts, cohort messages
curl -fsS -X POST https://hub.example.com/api/internal/drip/tick \
  -H "Authorization: Bearer $DRIP_CRON_TOKEN"

# Instructor schedule reminders
curl -fsS -X POST https://hub.example.com/api/internal/instructor/tick \
  -H "Authorization: Bearer $DRIP_CRON_TOKEN"
```

Both routes authenticate with `DRIP_CRON_TOKEN` (env or Integrations store) as a bearer token,
compared in constant time; if the token is not configured they refuse with 500. `GET` on either
route with the same header returns queue depth and whether SMTP is configured, without sending
anything. The drip `POST` accepts an optional JSON body `{ "sendLimit": n, "skipEnroll": true }`.

## 8. Optional services

- **Audio extractor** ([`audio-extractor/`](../audio-extractor/)): a small ffmpeg service with
  its own Dockerfile, used by the n8n audio-extraction workflow. See its README.
- **Rocket.Chat** for cohort chat, **Zoom**, **Google Cloud Storage**, **SMTP**: external
  services you point the hub at through env; none are required to boot.

## 9. After deploying

1. Sign in, then grant yourself `ADMIN` (see [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for
   creating the first admin; do not run the demo seed against production data).
2. Visit Admin → Integrations to confirm which keys resolve.
3. If you use Stripe, complete a test-mode purchase and confirm the webhook granted the seat.
4. Call the drip tick `GET` and confirm `smtpConfigured: true` if you expect email.
