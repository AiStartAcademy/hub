# Hub automated tests

Unit tests for the hub's business-logic layer, run with the built-in
[`bun test`](https://bun.sh/docs/cli/test) runner (jest-compatible API, no
extra dependencies, resolves the `@/*` tsconfig alias natively).

## Running

```bash
bun test tests/unit      # or: bun run test
bun run test:watch       # re-run on change
```

## Scope

`tests/unit/` covers the pure, deterministic helpers in `src/lib/` — the code
with the highest bug-cost-to-test-cost ratio and no I/O:

| File | Under test |
|------|-----------|
| `password.test.ts`    | `isPasswordValid` — complexity rules |
| `attribution.test.ts` | UTM / click-id parsing, cookie + segment parsing |
| `quizUtils.test.ts`   | letter↔index mapping, option-prefix strip, correct-answer resolution |
| `content.test.ts`     | template validation, URL derivation, JSON field (de)serialization round-trip |
| `slug.test.ts`        | `slugify` normalization + fallback |
| `tokens.test.ts`      | account-setup identifier parsing |
| `serviceAuth.test.ts` | bearer-token guard (allow / 401 / fail-closed 500) |

## Not yet covered (next candidates)

Route handlers and DB-touching helpers (`uniqueCohortSlug`,
`checkProgramAccess`, `buildQuizInTransaction`) need a Prisma test double or a
throwaway SQLite DB. Add those as an integration tier under `tests/integration/`
when needed — keep `tests/unit/` free of I/O so it stays fast.

`tests/` is excluded from `tsconfig.json` so `bun:test` imports never break
`next build`.
