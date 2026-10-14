# Public cohorts page

`/cohorts` is a public, logged-out, Luma-style calendar of cohorts: dates and times, format,
ticket tiers, seats left, and registration. It is the conversion destination for the funnel
(onboarding quiz → cohorts → pay). Registration is hub-native: Stripe Checkout for paid tiers, an
inline form for free ones.

Related: [PAYMENTS.md](./PAYMENTS.md), [PUBLIC_COHORTS_FEED.md](./PUBLIC_COHORTS_FEED.md),
[VIEWS.md](./VIEWS.md), [ONBOARDING.md](./ONBOARDING.md), [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md),
[ANALYTICS_SEO.md](./ANALYTICS_SEO.md).

## Model

| Concept | Storage |
|---|---|
| Cohort | `Cohort`: `title`, `slug` (unique, clean URL), `description` (rich HTML), `cover`, `status` (`DRAFT / ENROLLMENT / IN_PROGRESS / COMPLETE / ARCHIVED`), `deliveryMode` (`ONLINE / INPERSON / HYBRID`), `location`, `startDate`/`endDate`, display `startTime`/`endTime`/`timezone`, `tools` (comma-separated tags), `certificate` (badge), `leadMagnet` + `leadMagnetCta`, `memberEventType` |
| Ticket tier | `Group`: `name`, `inPerson`, `price` (dollars, float), `seats`, `allowOneOnOne` |
| Schedule | `CohortSession`: `title`, `date`, `startTime`, `endTime`, `timezone`, `status`, `meetingLink`, `recordingLink`, `linkedSessionId` |

Duration ("10 days", "3 weeks") is computed from the start and end dates: business days for spans
up to two weeks, rounded-up weeks beyond that. No field stores it.

**Seats** (`src/lib/seats.ts`): taken = `GroupMember` count + unexpired pending Stripe holds;
left = `seats − taken`, floored at zero. The list, the detail page and the checkout guard all use
this helper. Paid payments are not counted separately because the webhook adds the buyer as a
`GroupMember`.

**Slugs** (`src/lib/slug.ts`): generated from the title on create, settable through the API. Every
cohort route (`GET /api/cohorts/[id]`, checkout, enroll, register-free, the detail page) accepts
the slug or the id, and public links use `slug || id`.

## Routes

| Route | What |
|---|---|
| `/cohorts` | Server component. `MANAGE_ROLES` get the management UI (`CohortsManage.tsx`); everyone else gets `CohortsPublic.tsx`. Overrides the dashboard `noindex` with `index: true`, canonical and OG, and emits Event JSON-LD for enrolling cohorts. |
| `/cohorts/[id]` | Server selector: managers and enrolled members get the workspace (`views/ManageView.tsx`), guests and non-enrolled users get the indexable `views/PublicView.tsx` with its own metadata and JSON-LD. Indexed only for `ENROLLMENT`, `IN_PROGRESS`, `COMPLETE`. |
| `/cohorts/[id]/pay/[groupId]` | Paid-tier checkout page. A free or unknown group redirects to `/cohorts/<slug>#register`. |
| `/cohorts/[id]/edit` | Cohort edit page (sessions, join links). |

Public visibility statuses are `ENROLLMENT`, `IN_PROGRESS`, `COMPLETE`
(`src/lib/publicCohortVisibility.ts`). The list shows **Free events** (lead-magnet cohorts),
membership tier cards, **Upcoming cohorts** (non-lead-magnet, `ENROLLMENT` or `IN_PROGRESS`) and
**Past cohorts**. Each card has an accordion: About (sanitized HTML), Tools (tag chips), Schedule
(upcoming sessions) and Ticket tiers. Signed-in users already in a cohort see "Enrolled" instead of
Register. `/cohorts` and each public cohort URL are in `src/app/sitemap.ts`.

The list and the feed read through one allowlisted query, `loadPublicCohortRows`
(`src/lib/publicCohorts.server.ts`), so private fields never enter the public payload.
`GET /api/cohorts/[id]` returns the full workspace to managers and enrolled users; for everyone
else it blanks meeting and recording links, Zoom and chat ids, member lists, enrollments,
programs, materials, learning paths and instructor emails.

## Paid registration

Selecting a paid tier goes to `/cohorts/[id]/pay/[groupId]`. Guests enter name and email;
signed-in buyers continue straight to Stripe. `POST /api/cohorts/[id]/checkout` only sells
`ENROLLMENT` cohorts, holds the seat for 30 minutes, reuses an open session on retry, and refuses
sold-out tiers. The webhook grants the seat and, for a new passwordless buyer, emails a one-time
`/set-password` link. Details in [PAYMENTS.md](./PAYMENTS.md).

## Free seats

A free seat is triggered by a `Group` with `price: 0`, or by a cohort with `leadMagnet: true` and
no tiers. Both the list card and the detail rail render `src/components/FreeSeatForm.tsx` inline
when the selected tier is free.

`POST /api/cohorts/[id]/register-free` `{ name?, email?, waiverAccepted?, groupId? }`:

- Signed-in `STUDENT`s register with their session identity (staff get 403); guests give name and
  email.
- Rate-limited per IP (10 per 15 min) and per email (5 per 15 min).
- `DRAFT`, `ARCHIVED` and `COMPLETE` cohorts return 400; a paid group returns 400 ("use checkout").
- The visitor waiver is required when the chosen group is `inPerson` (no group: when the cohort is
  `INPERSON` or `HYBRID`).
- `grantFreeSeat` (`src/lib/freeSeat.ts`, idempotent, capacity-checked) creates or reuses a
  passwordless `STUDENT` `User` linked to the Contact, a `GroupMember`, and an `Enrollment` with
  `source: "free"`. The route also upserts the lead (first-touch attribution, `lead-magnet` and
  cohort tags, `COHORT_REGISTER` / `WAIVER_ACCEPTED` events).
- `sendFreeSeatEmail` sends the next session's time and join link plus, for a passwordless
  account, a 7-day `/set-password` link. There is no password-reset route, so an expired link
  means registering again or signing in with Google. The person is then enrolled in cohort
  reminder campaigns with the welcome step skipped.
- Response: `{ ok, enrolled, cohortUrl, joinLink? }`; `joinLink` only for authenticated callers.

## Per-session join links

`CohortSession.meetingLink` can be set per session from the edit page (Sessions → Set link): a
custom URL, or borrowed from another cohort's session via `linkedSessionId`.
`PATCH /api/cohorts/[id]/sessions/[sessionId]` resolves a borrowed URL server-side. Every
student-facing surface resolves the link with `resolveJoinLink` (session link, then
`Cohort.zoomLink`). A recording synced onto the source session is copied to borrowers that have
none (`propagateRecordingLink` in `src/lib/sessionLink.ts`).

Never write a borrowed meeting URL into the borrowing cohort's own `zoomLink`: the Zoom recording
webhook and the admin sync match cohorts by that column.

To surface a recurring free call (for example a weekly Q&A) to members, keep its free tiers, set
it to `ENROLLMENT`, tick "Show sessions in Member Calls as Weekly Q&A" (`memberEventType`), and
borrow each week's link from the running cohort's session. See [MEMBERS_AREA.md](./MEMBERS_AREA.md).

## Admin

The create/edit form (`CohortsManage.tsx`, `/cohorts/[id]/edit`) covers time and timezone, tools,
the rich-text description (Tiptap, loaded client-side), the certificate checkbox, lead-magnet
settings and `memberEventType`. `POST /api/cohorts` and `PUT /api/cohorts/[id]` persist them; the
slug has no form field and is changed by sending `slug` to `PUT /api/cohorts/[id]`.

## Gotchas

- Checkout sells only `ENROLLMENT`; an `IN_PROGRESS` cohort is listed as upcoming but cannot be
  bought.
- `Group.seats` (default 50) caps every tier at checkout, including online ones, even though the
  feed reports online capacity as unlimited.
- `Group.price` is a float in dollars; checkout converts to cents with `Math.round(price * 100)`.
