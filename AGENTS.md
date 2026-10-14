# AGENTS.md

Guide for AI coding agents (Claude Code, Codex, Cursor and others) working on the hub.
Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md). A compact doc map for any LLM is in
[llms.txt](./llms.txt).

## What this is

A Next.js 16 (App Router) + React 19 + TypeScript app with Prisma 6 on SQLite and Auth.js
(NextAuth v5). It is an LMS, a leads CRM with drip email/SMS, a Stripe storefront, and an
operations back office. Overview: [README.md](./README.md). Map: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Setup

```bash
npm ci                 # npm only: never add bun/yarn/pnpm lockfiles
cp .env.example .env   # defaults boot locally; integrations stay off
npm run db:generate    # project Prisma 6 (a global Prisma 7 rejects the schema)
npm run db:push        # no migration files in this repo
npm run seed:demo      # demo admin admin@example.com / admin1234 (local SQLite only)
npm run dev            # http://localhost:3000
```

## Rules

- **Prisma**: always through the `npm run db:*` scripts. Schema changes go in
  `prisma/schema.prisma` and ship via `db push`; prefer additive changes. The client lives in
  `src/generated/client/` and is not committed: rerun `npm run db:generate` after editing.
  SQLite: enums are `String`, structured data is JSON in a `String`.
- **Academy config**: never hardcode an academy name, domain, email, phone, address, price or
  marketing line under `src/`. Identity goes in `src/config/brand.ts`, business copy in
  `src/config/content.ts`, deployment ids in `src/config/catalog.ts`. Empty values must hide
  the matching UI. `tests/unit/brand-config.test.ts` enforces the brand part.
- **Secrets and PII**: never commit secrets, real personal data, customer records or a
  database file. No PII in logs or URLs.
- **Auth**: there is no global middleware. Every route handler checks the session and role
  (`src/lib/roles.ts`, `src/lib/adminGuard.ts`). Machine routes use bearer tokens via
  `src/lib/serviceAuth.ts`; webhooks verify provider signatures. Guards fail closed when their
  secret is unset. Never weaken either. See [docs/SECURITY.md](./docs/SECURITY.md).
- **Async guards**: guards such as `mcpWritesEnabled()` are async. Always `await` them; a
  Promise in an `if (!guard())` is always truthy and silently disables the check. A unit test
  scans for this.
- **Build safety**: no module may construct an env-dependent client (Stripe, Twilio, SMTP, GCS)
  at import time; `next build` runs with an empty environment. Prerendered routes must not
  touch Prisma.
- **Logic placement**: decisions go in `src/lib/**` as pure functions with unit tests; route
  handlers and server actions stay thin.
- **Server/client split**: a `"use client"` page cannot export `metadata`; wrap it in a server
  `page.tsx`. See [docs/CONVENTIONS.md](./docs/CONVENTIONS.md).
- **Consent**: any new email, SMS or call path must respect the consent fields on `Contact`
  (marketing vs course email, SMS, calls). See [docs/features/DRIP_CAMPAIGNS.md](./docs/features/DRIP_CAMPAIGNS.md).

## Tests

- `bun test tests/unit` runs the unit suite (bun is the runner; npm stays the package manager).
- Write the test first for new behavior: one named test per success criterion, red before green.
- `mock.module` mocks are process-wide in bun, so a partial mock can leak into files that run
  later. Spread the real module into partial mocks. CI runs `npm run test:isolated` (one process
  per file); if a test passes there but fails under `bun test tests/unit`, a mock leaked.

## Task recipes

**Add an environment variable**
1. Read it lazily where it is used (never at import time).
2. Add a placeholder line to `.env.example` in the right group.
3. Add a row to [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md).
4. If admins should set it at runtime, add it to
   `src/app/(dashboard)/admin/integrations/knownKeys.ts`.

**Add a database field or model**
1. Edit `prisma/schema.prisma` (additive; default values for new required fields).
2. `npm run db:push && npm run db:generate`.
3. Cover the new logic in `src/lib/**` with unit tests.

**Add a page**
1. Server `page.tsx` under `src/app/(dashboard)/<area>/` (signed-in) or `src/app/<route>/`
   (public), exporting `metadata` built from `brand`.
2. Interactive parts go in a separate `"use client"` component.
3. Check the role in the page or its data loader; public pages must not leak private data.

**Add an MCP API endpoint**
1. `src/app/api/internal/mcp/v1/<area>/route.ts`.
2. First line of every handler: `const denied = await requireMcpToken(req); if (denied) return denied;`
3. Writes also need `if (!(await mcpWritesEnabled())) return mcpError("MCP writes are disabled", 403);`
4. Respond with `mcpJson` / `mcpError` from `src/lib/mcpApi.ts`, and document the endpoint in
   [docs/MCP_API.md](./docs/MCP_API.md).

**Send a new kind of message**
1. Decide its consent scope first (marketing or course email, SMS, call).
2. Route it through the existing senders in `src/lib/mail.ts` / the drip engine rather than a new
   transport, so tracking, unsubscribe and send windows apply.

## Before you open a PR

```bash
npx tsc --noEmit
bun test tests/unit
npm run build
```

CI runs these three (tests via `npm run test:isolated`); `npm run build` is the real gate. `npm run lint` reports existing debt:
don't add new findings in the files you touch. Also exercise the affected flow by hand
(`npm run dev` with the demo seed), and update the relevant `docs/features/*.md` in the same PR.

## Where things are

- Pages: `src/app/(dashboard)/<area>/`, public flows in `src/app/<route>/`
- API: `src/app/api/**/route.ts`; MCP API in `src/app/api/internal/mcp/` ([docs/MCP_API.md](./docs/MCP_API.md))
- Domain logic and integrations: `src/lib/`
- Academy config: `src/config/{brand,content,catalog}.ts`
- Feature docs: [docs/features/](./docs/features/)
- Env reference: [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md)
