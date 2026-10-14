# Public cohorts feed

`GET /api/public/cohorts` is a cross-origin, read-only JSON feed of upcoming cohorts, meant for a
static marketing site that lists cohorts without its own database. It reads no session or cookie.

Implementation: `src/app/api/public/cohorts/route.ts` wires `createPublicCohortsHandlers` from
`src/lib/publicCohortsFeed.ts` to the shared loader `loadPublicCohortRows`
(`src/lib/publicCohorts.server.ts`). Tests: `tests/unit/public-cohorts-feed.test.ts`.

Related: [COHORTS_PUBLIC.md](./COHORTS_PUBLIC.md), [../SECURITY.md](../SECURITY.md).

## Cohort selection

The feed uses the same allowlisted database read, projection, upcoming predicate
(`isUpcomingPublicCohort`), ticket ordering and seat calculation as the public `/cohorts` page.
It returns non-lead-magnet cohorts whose status is `ENROLLMENT` or `IN_PROGRESS`, ordered by
`startDate` ascending with undated cohorts last. The page's Free events and Past cohorts sections
are not in the feed.

Each cohort's public URL is `${brand.urls.hub}/cohorts/{slug}`, for example
`https://hub.example.com/cohorts/fall-hybrid`. A cohort without a stored slug uses its database id,
matching the detail route's `slug || id` behavior.

## Response contract

Status `200`:

```json
{
  "generatedAt": "2026-01-05T12:00:00.000Z",
  "cohorts": [
    {
      "slug": "fall-hybrid",
      "title": "Fall Hybrid Cohort",
      "url": "https://hub.example.com/cohorts/fall-hybrid",
      "startDate": "2026-02-02",
      "endDate": "2026-02-13",
      "startTime": "9:00 AM",
      "endTime": "5:00 PM",
      "timezone": "PT",
      "sessionCount": 10,
      "deliveryMode": "HYBRID",
      "location": "Example City",
      "certificate": true,
      "priceFrom": { "amount": 10000, "currency": "usd" },
      "tickets": [
        {
          "label": "Online",
          "mode": "online",
          "price": { "amount": 10000, "currency": "usd" },
          "capacity": null,
          "seatsLeft": null
        },
        {
          "label": "In Person",
          "mode": "in_person",
          "price": { "amount": 20000, "currency": "usd" },
          "capacity": 20,
          "seatsLeft": 9
        }
      ]
    }
  ]
}
```

Values above are illustrative.

- Dates are `YYYY-MM-DD` or `null`. Times and `timezone` are the cohort's stored display strings.
- Money is integer minor units; the currency is always `usd`.
- `priceFrom` is the lowest ticket price, including zero for a free ticket, and `null` when the
  cohort has no tickets. (The `/cohorts` page instead advertises the lowest paid price.)
- `sessionCount` counts the session rows the public page's schedule shows. That filter drops a
  session only when its `startTime` parses as a past timestamp; clock strings such as `10:00 AM`
  do not parse, so in practice every session row is counted.
- Online tickets report `capacity` and `seatsLeft` as `null`. In-person `seatsLeft` is the same
  clamped value as `/cohorts`: capacity minus group members and unexpired pending Stripe holds,
  never below zero. Checkout still enforces `Group.seats` for every tier.

The payload is an explicit field-by-field projection. It never includes meeting links, chat data,
program ids, viewer enrollment state, member counts, emails, or user or instructor ids.

On an internal failure the route logs server-side and returns `500` with only:

```json
{ "error": "unavailable" }
```

## CORS

`Access-Control-Allow-Origin` is echoed only for an exact match against
`PUBLIC_COHORTS_ALLOWED_ORIGINS`: `brand.urls.site`, `brand.urls.siteWww`, and
`http://localhost:3025` (local static-site development). With the default brand that is
`https://example.com` and `https://www.example.com`. Edit `src/config/brand.ts` to change them.

Every response carries `Vary: Origin` and `Access-Control-Allow-Methods: GET, OPTIONS`.
Credentials are not allowed. `OPTIONS` returns an empty `204`.

## Caching

Successful responses:

```text
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600
```

Seat counts can therefore lag by about five minutes through a CDN; checkout does its own live
capacity check. Error and preflight responses use `Cache-Control: no-store`.
