## What and why

## How it was tested

- [ ] `npx tsc --noEmit`
- [ ] `bun test tests/unit` (new behavior has a test)
- [ ] `npm run build`
- [ ] Exercised the flow by hand with `npm run dev` + `npm run seed:demo`

## Checklist

- [ ] No hardcoded academy names, domains, prices or copy (use `src/config/{brand,content,catalog}.ts`)
- [ ] New env vars added to `.env.example` and `docs/ENVIRONMENT.md`
- [ ] Relevant `docs/features/*.md` updated
- [ ] No secrets or real personal data in code, fixtures or screenshots
