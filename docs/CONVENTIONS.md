# Conventions

How code is written in the hub, so new code reads like the existing code.

## Tooling

- **npm** for dependencies (`npm ci`). Do not add `bun.lock`, `yarn.lock` or
  `pnpm-lock.yaml`. Bun is used only as the test runner.
- **Prisma 6** through the `npm run db:*` scripts, never a global or unpinned `npx prisma`
  (Prisma 7 rejects this schema).
- **Next.js 16** App Router with Turbopack, **React 19**, **TypeScript**, **Tailwind v4**.
- `tsx` for one-off scripts in `scripts/` (`node --env-file=.env --import tsx scripts/<name>.ts`).

## Brand-neutral code

Every academy-specific value (name, wordmark, domains, emails, phone, address, venue, social
links, signer, SMS prefix, timezone, product names, machine-readable ids) lives in
[`src/config/brand.ts`](../src/config/brand.ts). Import `brand` (or the derived helpers such as
`brandFromMailbox`) instead of writing those values anywhere else under `src/`. The unit test
`tests/unit/brand-config.test.ts` enforces this. Catalog ids that differ per deployment come from
env through `src/config/catalog.ts`.

## Code layout

- **API routes**: `src/app/api/<resource>/route.ts`, item operations in `[id]/route.ts`.
  Admin-only routes under `/api/admin/`; machine routes under `/api/internal/*`,
  `/api/content/*`, `/api/agents/*`, `/api/webhooks/*`, `/api/n8n/*` with token or signature
  auth (see [SECURITY.md](./SECURITY.md)).
- **Feature UI** under `src/app/(dashboard)/<area>/`; shared UI in `src/components/`; domain
  logic and integrations in `src/lib/`. Integrations are called from route handlers and server
  actions, not inlined into components.
- **Rich text**: the Tiptap editor is loaded with `next/dynamic` and `ssr: false`.

## Server and client components

A `"use client"` page cannot export `metadata`. To make a route public and indexable, keep
`page.tsx` a **server** component that sets metadata (index, canonical, Open Graph) and fetches
data guest-aware (treat a missing session as a guest with no manage rights), then render a
client child for interactivity. `/courses` is the reference implementation.

## URL state

Interactive state that should survive navigation, refresh and sharing belongs in query
parameters, parsed and serialized by a pure `*Params.ts` module next to the page. That module
contains no React or Prisma code and is unit-tested on its own; see
`src/app/(dashboard)/admin/contacts/leadListParams.ts` and
`src/app/onboarding/[slug]/onboardingStepParams.ts`. PII, including form answers, never goes in
a URL.

## Build safety

- `next build` evaluates route modules while collecting page data. **No module may construct
  an env-dependent client at import time** (Stripe, Twilio, SMTP transport, GCS). Create it
  lazily inside the function that uses it.
- Routes Next prerenders statically must not touch Prisma. Mark data routes
  `export const dynamic = "force-dynamic"` when in doubt.
- Prefer `getSecret(key)` for any key an operator may want to rotate from Admin → Integrations.

## Database

- Schema changes go in `prisma/schema.prisma` and are applied with `prisma db push`. There are
  no migration files. Make additive changes (new nullable columns, new models) whenever
  possible; dropping or narrowing a column needs `--accept-data-loss` and can lose data.
- After a schema change, run `npm run db:generate` (the client in
  `src/generated/client/` is not committed).
- Enums are `String` columns; structured data is JSON stored in a `String` column. Parse it
  defensively.
- When changing `Program` / `Module` / `Lesson` structure, maintain the `order` field and bump
  the parent's `updatedAt`.

## Testing

- Unit tests live in `tests/unit/*.test.ts` and run with `bun test tests/unit`. Prisma and mail
  are mocked with `mock.module`; mocks are process-wide in bun, so reset them in each file.
- Test-first for new behavior: write the success criteria, one named test per criterion
  (e.g. `it("SC-3: refunds revoke the seat")`), see it fail, then implement.
- Keep decision logic in `src/lib/**` as pure functions so it can be tested without Prisma,
  Stripe or Twilio.
- What unit tests cannot reach (rendered UI, real telephony, provider dashboards) needs a
  named manual check in the pull request.

## Before a pull request

```bash
npx tsc --noEmit
bun test tests/unit
npm run lint
npm run build
```

`npm run build` is the real gate; CI runs it with only the Core variables set.

## Docs

Feature docs live in `docs/features/<NAME>.md`. Update the relevant doc in the same pull
request as the code.
