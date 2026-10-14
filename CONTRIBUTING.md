# Contributing

Thanks for helping improve the hub.

## Ground rules

- Open an issue before a large change so we can agree on the approach.
- One logical change per pull request, with tests. Behavior changes need a unit test in
  `tests/unit` (run with `bun test tests/unit`).
- The project uses **npm** for dependencies (`npm ci`), Prisma 6 through `npm run db:generate` /
  `npm run db:push` (not a global Prisma), and `db push` instead of migration files.
- Keep brand-specific values out of code. Names, contact details, addresses and logos belong in
  `src/config/brand.ts`.
- No secrets, real personal data, or customer records in commits, fixtures, or screenshots.

## Before you open a PR

```bash
npx tsc --noEmit
bun test tests/unit
npm run build
```

CI runs the same three. `npm run lint` reports existing debt; please don't add new findings in the
files you touch. Using an AI coding agent? Point it at [AGENTS.md](./AGENTS.md).

## License

By contributing you agree that your contributions are licensed under the project's
[AGPL-3.0 license](./LICENSE).
