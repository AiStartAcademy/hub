# Marketing Attribution (UTM Capture)

Captures UTM parameters and ad click ids from inbound links (ads, email, social) and attaches
them to leads, user profiles and purchases, so you can tell which campaign produced which
signup or sale.

## How it works

1. **Capture (client).** `src/components/UtmCapture.tsx` is mounted in the root layout. On
   landing it parses `window.location.search` for known keys and, if any are present, writes a
   first-touch attribution cookie (name: `ATTRIBUTION_COOKIE` in `src/lib/attribution.ts`;
   URL-encoded JSON, 90-day max-age, `SameSite=Lax`, `path=/`). It also pushes an
   `attribution_captured` event with the same values to the GTM `dataLayer`.
2. **Persist.** Because the value lives in a cookie it survives navigation: a visitor can land
   from an ad, click through a multi-step quiz with the query string long gone, and the
   original source is still available at submit time.
3. **Attach (server).** Route handlers read the cookie with `parseAttributionCookie` and store
   it as a JSON string.

| Where it is stored | Written by |
|--------------------|------------|
| `OnboardingResponse.attribution` and `Contact.attribution` | `POST /api/onboarding/[slug]` |
| `User.attribution` | `POST /api/register` (credentials signup) |
| `Payment.attribution` | `POST /api/cohorts/[id]/checkout`, `POST /api/programs/[id]/checkout` |
| `Membership.attribution` | `POST /api/membership/checkout` |
| `Contact.attribution` (first touch) | newsletter signup, venue-event registration, free-seat registration, asset download |

`Enrollment` also has an `attribution` column for purchase-time attribution.

## First-touch semantics

The client never overwrites an existing cookie, so the first campaign that brought a visitor
in keeps the credit. Server-side, contact upserts also keep the original
`Contact.attribution` on later submissions. To switch to last-touch, remove the
"already set" guard in `UtmCapture.tsx`.

## Captured fields

| Group | Keys |
|-------|------|
| UTM | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` |
| Click ids | `fbclid` (Meta), `gclid` / `gbraid` / `wbraid` (Google), `ttclid` (TikTok), `li_fat_id` (LinkedIn), `msclkid` (Microsoft), `twclid` (X) |
| Context | `referrer`, `landing_page`, `captured_at` |

Values are normalized on parse: control characters and `<` `>` are stripped, values are
trimmed and capped (2048 characters for `referrer` / `landing_page`, 500 otherwise), and
unknown keys are dropped. Treat the cookie as untrusted client input.

## Where to see it

- **Onboarding responses** (`/onboarding-responses`): the CSV export includes UTM Source,
  Medium, Campaign, Content, Click ID and Landing Page columns.
- **Leads Database** (`/admin/contacts`): the Ad Campaign column and the lead profile show
  first-touch attribution ([LEADS.md](./LEADS.md)).
- **GTM / GA4**: the `attribution_captured` dataLayer event.

## Example

Ad link:

```
https://hub.example.com/onboarding/example-quiz?utm_source=facebook&utm_medium=cpc&utm_campaign=spring_launch&utm_content=carousel_a&fbclid=EXAMPLE123
```

Stored on the resulting `OnboardingResponse.attribution`:

```json
{"utm_source":"facebook","utm_medium":"cpc","utm_campaign":"spring_launch",
 "utm_content":"carousel_a","fbclid":"EXAMPLE123",
 "landing_page":"/onboarding/example-quiz","captured_at":"2026-01-01T12:00:00.000Z"}
```

## Key files

| File | Role |
|------|------|
| `src/lib/attribution.ts` | Client-safe parse and normalize helpers, cookie names, key lists |
| `src/components/UtmCapture.tsx` | Client capture into the first-touch cookie and dataLayer |
| `src/app/api/onboarding/[slug]/route.ts` | Stores attribution on the response and lead |
| `src/app/api/register/route.ts` | Stores attribution on the user |
| `src/app/(dashboard)/onboarding-responses/OnboardingResponsesClient.tsx` | CSV export columns |

## Known gaps

- Google OAuth signups do not record `User.attribution`; only the credentials `register`
  route does.
- The optional GoHighLevel sync pushes UTM custom fields only from the asset-download flow
  (`GHL_UTM_SOURCE_ID`, `GHL_UTM_MEDIUM_ID`, `GHL_UTM_CAMPAIGN_ID`, `GHL_UTM_CONTENT_ID` in
  `src/app/api/download-contact/route.ts`), not from onboarding.
