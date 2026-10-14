# Local Development

Run the hub on your machine with a fresh SQLite database and no external services.

## Prerequisites

- **Node.js 20+** and **npm** (the repo ships `package-lock.json`; do not add another lockfile).
- **Bun** for the unit-test runner only (`bun test tests/unit`).
- Optional: the [Stripe CLI](https://stripe.com/docs/stripe-cli) if you work on payments.

Docker, Google credentials, Zoom, Twilio, SMTP and the rest are **not** needed to boot. Each
integration stays inactive until its variables are set.

## 1. Install

```bash
npm ci
```

## 2. Configure `.env`

```bash
cp .env.example .env
```

The Core defaults boot a local copy as-is: `DATABASE_URL="file:./dev.db"` resolves from `prisma/`,
so the database lands at `prisma/dev.db`. Before exposing the app anywhere, replace the secrets:

```bash
AUTH_SECRET="<openssl rand -hex 32>"
NEXTAUTH_SECRET="<same value>"
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"
```

Leave every other group blank until you need it. Full reference:
[ENVIRONMENT.md](./ENVIRONMENT.md).

## 3. Create the database

The project uses `prisma db push` (no migration files). Always use the project-pinned Prisma 6
binary: a global or `npx`-resolved Prisma 7 rejects this schema.

```bash
npm run db:generate
npm run db:push
```

The generated client is written to `src/generated/client/` and is not committed; regenerate it
after every pull that changes `prisma/schema.prisma`.

If `prisma generate` fails in the `prisma-erd-generator` step (it renders an ERD with headless
Chromium), generate only the client:

```bash
npm run db:generate -- --generator client
```

## 4. Seed demo data

```bash
npm run seed:demo
```

This creates a demo admin account (`admin@example.com` / `admin1234`) and a demo program and
cohort so the dashboard is not empty. It is meant for local and throwaway databases only; never
run it against a database with real users.

## 5. Start the dev server

```bash
npm run dev
# http://localhost:3000
```

Sign in at `http://localhost:3000/login` with the demo admin.

## Working on integrations locally

- **Stripe**: put test keys in `.env`, then forward webhooks:

  ```bash
  stripe listen --forward-to localhost:3000/api/webhooks/stripe
  ```

  Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`. The webhook is the only path that
  grants paid access, so a purchase without it pays but grants nothing.
- **Integrations store**: set `SETTINGS_ENC_KEY` (`openssl rand -base64 32`) to save secrets
  from Admin → Integrations instead of `.env`.
- **Drip runner**: set `DRIP_CRON_TOKEN` and call the tick yourself:

  ```bash
  curl -X POST http://localhost:3000/api/internal/drip/tick \
    -H "Authorization: Bearer $DRIP_CRON_TOKEN"
  ```

- **Email**: with `SMTP_HOST` unset, sends are skipped. Point `SMTP_*` at a local catcher such
  as Mailpit to see messages.
- **Twilio and Zoom webhooks** need a public HTTPS URL (a tunnel) and `NEXT_PUBLIC_APP_URL`
  set to that URL, because Twilio signatures are validated against it.
- **MCP**: set `HUB_MCP_TOKEN` (and `HUB_MCP_WRITES_ENABLED=true` for writes) and point the MCP
  server at `http://localhost:3000`. See [MCP_API.md](./MCP_API.md).

## Useful commands

```bash
npm run dev                            # dev server (Turbopack)
npm run build                          # production build: the real gate
npx tsc --noEmit                       # fast type check (not a substitute for build)
npm run lint                           # ESLint
bun test tests/unit                    # unit tests
npm run verify:onboarding              # onboarding regression check
npm exec prisma studio      # browse the database
npm run db:push     # re-apply the schema after editing it
```

## Gotchas

- **Build with an empty environment.** `next build` evaluates route modules while collecting
  page data, and CI builds with only the Core variables. No module may construct an
  env-dependent client (Stripe, Twilio, SMTP, GCS) at import time; create it lazily inside the
  handler. Statically prerendered routes must not touch Prisma.
- **Port in use**: `npm run dev -- -p 3001`.
- **Parallel dev servers**: set `NEXT_DIST_DIR` to an alternate directory so two `next dev`
  processes do not share one `.next` cache.
- **Google login button** errors without `GOOGLE_CLIENT_ID`; use email/password.
- **Media uploads** fail without the `GCS_*` variables.
- **Dates in SQLite** are stored as epoch milliseconds; keep that in mind when querying the
  file directly.
