# Onboarding Quizzes

Public, branching quizzes that segment visitors, capture them as leads, and route them to a
next step (a cohort page, a free resource, an external URL). A typical funnel points an ad at
a quiz; the quiz tags the lead and sends them on.

- Public URL: `/onboarding/[slug]` (noindex).
- Admin list and builder: `/admin/onboarding`, `/admin/onboarding/[id]/edit`.
- Responses: `/onboarding-responses`.

## Data model

```
OnboardingForm
├── steps: OnboardingStep[]               # ordered steps
│   └── elements: OnboardingElement[]     # single_choice | multiple_choice | text_single | text_multi | phone
│       └── options: OnboardingOption[]   # tag, nextStepId, redirectUrl
├── routingElementId                      # the one question that controls navigation
├── defaultRedirectUrl                    # fallback destination
├── ghlFieldMapping                       # JSON: element ids for firstName/lastName/contactName/email/phone
├── aiPrompt                              # optional AI recommendation prompt
├── tagMappings: OnboardingTagCohort[]    # legacy tag → cohort/url routes
└── responses: OnboardingResponse[]       # answers, tagCounts, cohortId, status, aiResult, attribution
```

- `OnboardingOption.tag` is a segmentation label (for example `goal-agency`). Tags are counted
  per response and merged onto the lead.
- `OnboardingOption.nextStepId` gives per-option branching (jump to a step).
- `ghlFieldMapping` is the field mapping used for both the internal lead store and the
  optional GoHighLevel sync, despite its name.

## Routing: answer → destination

Navigation is kept separate from segmentation. A form can name one single-choice question as
its redirect question (`routingElementId`); each answer of that question can carry a
`redirectUrl`.

On submit (`POST /api/onboarding/[slug]`) the destination is resolved as:

1. The `redirectUrl` of the selected option of the redirect question.
2. Otherwise `defaultRedirectUrl`.
3. Otherwise the legacy `OnboardingTagCohort` route for the highest-count tag (URL, or a cohort,
   which yields `/cohorts/{id}`). Ties are broken deterministically in favour of the later
   step/element/option; there is no random choice.
4. If nothing matched and `aiPrompt` is set, the response is stored as `PROCESSING` and AI
   analysis runs in the background (see below).

The player does a full navigation for `http(s)` URLs and uses the app router for internal paths.

Redirect URLs (`normalizeRedirectUrl` in `src/lib/onboarding-security.ts`) must be an internal
path starting with `/` or an `https://` URL. Plain `http://` is accepted only for `localhost`,
`127.0.0.1` and `::1`. Protocol-relative, credentialed, backslash-containing, over-long and
malformed values are rejected.

### Migrating legacy tag routes

`OnboardingTagCohort` rows are kept as a working fallback. In the builder, the
**Import N legacy tag destinations into matching answers** button (`importLegacyTagRoutes`)
copies each saved URL or cohort path onto the options carrying that tag. It does not delete
the old mappings. Then pick and review the redirect question.

## AI recommendations

When a form has `aiPrompt` and no destination resolves, the server calls OpenRouter
(`OPENROUTER_API_KEY`) with the sanitized answers and the catalog of programs whose status is
`open`, and asks for one to three ranked recommendations. Output is filtered to real program
ids, clamped and sanitized, then stored in `OnboardingResponse.aiResult` with status
`COMPLETED` (or `ERROR` on failure). The player polls `GET /api/onboarding/responses/[id]`.

## Player UX

`src/app/onboarding/[slug]/OnboardingPlayer.tsx`:

- A step whose only input is a single-choice question auto-advances 300 ms after a click.
  Clicking another option inside that window resets the timer.
- On the last such step the click auto-submits.
- Multi-select, text and phone steps keep the **Next** button; Next is a fallback everywhere.
- A successful submit pushes `generate_lead` and the Meta `Lead` event once
  (see [ANALYTICS_SEO.md](./ANALYTICS_SEO.md)).

## Lead capture

Every valid submission best-effort upserts a `Contact` (`captureOnboardingLead` in
`src/lib/onboarding-leads.ts`): source `onboarding:{slug}`, merged tags, first-touch
attribution, and an `ONBOARDING` `ContactEvent`. Lead-capture failures are logged and never
block the quiz. When a form has no saved mapping, common labels (First name, Last name, Email,
Phone) are inferred (`src/lib/onboarding-fields.ts`); first and last name are combined into
`Contact.name`.

`ContactEvent.onboardingResponseId` is unique, which makes replays idempotent. On
`/onboarding-responses` each form has:

- **Fields** — set the mapping explicitly when labels are nonstandard.
- **Sync Leads** — backfill old responses into the Leads Database; safe to re-run.
- **GHL** — optional GoHighLevel sync with the same mapping (no-op without `GHL_*` config).
- **CSV** export, including attribution columns.

The submit response also sets an httpOnly segment cookie (the winning tag, 90 days) and, on
successful capture, client-readable lead email/name cookies (`src/lib/lead-cookie.ts`) that
identify the anonymous lead to later pages. They are client-writable, so they must never be
trusted to mutate an existing account.

### Phone step and consent

A `phone` element is always optional, whatever its `required` flag says. Under the number it
shows three separate, unchecked checkboxes (marketing texts, non-marketing reminder texts,
phone calls) followed by links to the Terms of Service and Privacy Policy. This layout is what
US A2P 10DLC carrier review expects; do not merge the boxes or pre-check one.

The POST body carries `phoneConsent: { smsMarketing, smsTransactional, calls }` next to
`answers`. The server counts a flag only when it is strictly `true`. If no flag is set, the
mapped phone answer is blanked before validation, so a phone without consent is never stored.
Each ticked box stamps its own `Contact` timestamp (`smsMarketingConsentAt`,
`smsTransactionalConsentAt`, `phoneConsentAt`). A later submission for the same number never
clears or re-stamps an existing grant; a submission that changes the number resets all three
to exactly what was ticked (`planOnboardingConsentGrant`). **Sync Leads** replays responses
without consent flags, so it can fill a phone but never grants consent. Consent scopes and
send rules: [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md).

## Request hardening

- The submit route requires `Content-Type: application/json` (415 otherwise) and caps the body
  at 64 KiB (413).
- It rejects unknown element ids and options submitted under the wrong question, checks
  required fields, and validates mapped email and phone values.
- Text is converted to bounded plain text before storage; builder fields, attribution, AI
  output and external CRM payloads are normalized at the server boundary.
- The public page serializes only renderable fields. AI prompts, field mappings, tags and
  routing configuration are never sent to visitors.
- CSV export prefixes formula-leading cells (`=`, `+`, `-`, `@`) with `'`.

`npm run verify:onboarding` runs `scripts/verify-onboarding.ts`, a regression check that
creates disposable records (point it at a development database). It covers field inference,
XSS stripping, forged option rejection, deterministic legacy routing, safe redirect fallback
and idempotent lead events.

## Key files

| File | Role |
|------|------|
| `src/app/(dashboard)/admin/onboarding/[id]/edit/OnboardingBuilder.tsx` | Builder UI (steps, elements, redirect routing) |
| `src/app/(dashboard)/admin/onboarding/actions.ts` | Server actions: CRUD, URL validation, legacy import, field mapping, Sync Leads, GHL |
| `src/app/onboarding/[slug]/OnboardingPlayer.tsx` | Public player |
| `src/app/api/onboarding/[slug]/route.ts` | Validated submit, lead capture, routing, AI analysis |
| `src/app/api/onboarding/responses/[id]/route.ts` | Poll endpoint for AI results |
| `src/app/(dashboard)/onboarding-responses/OnboardingResponsesClient.tsx` | Responses table, Fields, Sync Leads, GHL, CSV |
| `src/lib/onboarding-security.ts` | Plain-text, email/phone, answer and URL validation |
| `src/lib/onboarding-fields.ts` | Field mapping parse and label inference |
| `src/lib/onboarding-leads.ts` | Lead upsert and idempotent event |
| `src/lib/onboarding-phone-consent.ts` | Consent parsing and grant planning |
| `scripts/verify-onboarding.ts` | Regression verifier |

Related: [ATTRIBUTION.md](./ATTRIBUTION.md), [LEADS.md](./LEADS.md).
