# Venue Rentals

The hub doubles as a booking system for the academy's physical space. Outside organizers request
a slot on a public venue calendar, staff approve it, and an approved event gets a public landing
page with its own registration form and visitor waiver. Paid rentals add an e-signed rental
agreement and a Stripe Payment Link, wired together so the organizer signs and is then sent
straight to payment (sign-then-pay). Staff run everything from `/admin/venue-events` or through
the MCP API.

## Data model

| Model | Key fields |
|-------|------------|
| `VenueEvent` | `title`, unique `slug`, `type`, `organizerName`, `orgName`, `contactEmail`, `contactPhone`, `date` / `endDate` (date-only, UTC midnight), `startTime` / `endTime` (`"7:00 PM"` strings), `timezone`, `capacity`, `status`, `dealType`, `isOnline`, `source` (`FORM`, `MCP`, `ADMIN`), `contactId` (lead link), `gcalEventId` / `gcalSyncError` / `gcalSyncedAt` |
| | Internal only, never public: `dealNote`, `adminNote`, `quoteAmountCents`, `quoteNote`, `rentalFeeCents`, `rentalDepositCents`, `rentalPaymentLinkId`, `rentalPaymentUrl`, `rentalPaymentStatus` |
| | Landing-page content: `subtitle`, `description`, `cover`, `videoUrl`, `priceNote`, `ticketPriceCents`, `ticketPaymentLink`, `externalRegistrationUrl`, plus JSON strings `gallery`, `agenda`, `hosts`, `pricingTiers`, `faq` |
| `VenueEventRegistration` | `name`, `email` (unique per event), `phone`, `status` (`CONFIRMED`, `PENDING_PAYMENT`, `CANCELLED`), `waiverAcceptedAt`, `waiverVersion`, `ip`, `userAgent`, `contactId` |
| `VenueAgreement` | `templateKey`, rendered `contentMd`, unique `token`, `status` (`DRAFT`, `SENT`, `SIGNED`, `VOID`), signer name/email/title, `signatureText`, `signatureSvg`, `signedAt`, `signerIp`, `userAgent`, `sentAt`, countersignature fields (`aisaSignedAt`, `aisaSignerName`, `aisaSignerTitle`) |
| `Payment` | Rental rows carry `venueEventId` and `stripePaymentLinkId` ([PAYMENTS.md](./PAYMENTS.md)) |

`type` is one of `NETWORKING`, `HACKATHON`, `WORKSHOP`, `MEETUP`, `INTERVIEW`, `PODCAST`, `PANEL`,
`DEMO_DAY`, `KIDS_PROGRAM`, `MOVIE_CLUB`, `OTHER`. `dealType` is one of `PAID_RENTAL` (default),
`BARTER`, `REVENUE_SHARE`, `FREE_PROMO`, `INTERNAL`. Never read the JSON content columns raw: go
through `src/lib/venueEventContent.ts`, which returns `[]` on malformed JSON.

## Event statuses

| Status | Meaning | Visible publicly | Google Calendar |
|--------|---------|------------------|-----------------|
| `PENDING` | Request or unconfirmed booking. Column default and what the public form creates. | Only as an anonymous "Tentative hold" (date and time) | Tentative `[HOLD]` event, no attendees |
| `APPROVED` | Confirmed booking | Event page, `/events` listing, ICS, registration | Confirmed event; organizer and `GOOGLE_CALENDAR_ORGANIZER_EMAIL` invited (`sendUpdates: "all"`) |
| `DECLINED` | Request turned down | No | Event cancelled |
| `CANCELLED` | Booking called off | Event page stays reachable and shows it as cancelled; no registration | Event cancelled |

Calendar sync (`syncVenueEventToGcal`) runs on create and whenever status, date, times or title
change. It never throws; failures land in `gcalSyncError` and are skipped entirely when Google
Calendar is not configured.

## Flow: request to booking

1. **Request.** A visitor picks a slot on `/calendar` and submits `VenueRequestModal`, which posts
   to `POST /api/public/venue-events` (5 requests per IP per hour). The route upserts a `Contact`
   (source `venue-calendar`, tag `venue-request`, first-touch attribution on create), logs a
   `VENUE_EVENT_REQUEST` contact event, creates a `PENDING` event with `source: "FORM"`, syncs a
   tentative calendar hold, and emails `INTERNAL_NOTIFICATION_EMAIL`. Overlapping cohort sessions
   and venue bookings are returned as `conflicts` but do not block the request.
2. **Review.** Staff open the event in the `/admin/venue-events` drawer (list defaults to
   `PENDING`), set deal type, quote and notes, and edit the public page content.
3. **Agreement** (optional). Create from a template, then send (below).
4. **Payment link** (`PAID_RENTAL` only). Issue a Stripe Payment Link for fee plus deposit.
5. **Organizer email.** The drawer composes a draft (see below) for staff to send by hand.
6. **Approve.** Setting `APPROVED` from the admin drawer emails the organizer a confirmation with
   the event page link and syncs the confirmed calendar event. Setting `DECLINED` emails a decline
   only when `sendDeclineEmail: true` is passed.

## Agreements and sign-then-pay

Templates live in `src/content/agreements/` (`paid-rental.md`, `free-barter.md`,
`revenue-share.md`) and are rendered by `agreementTemplates.ts`. With no explicit `templateKey`
the deal type picks one: `PAID_RENTAL` maps to `paid-rental`, `BARTER` and `FREE_PROMO` to
`free-barter`, `REVENUE_SHARE` to `revenue-share`; `INTERNAL` has no template and returns 400.

1. **Create.** Variables default from the event (org name, title, date, times, signer name) and
   are overridden by the request's `variables`. Rendering uses `allowMissing`: organizer-fillable
   variables become `[[organizer:key]]` markers, anything else missing becomes a visible blank. A
   32-byte random hex `token` is minted and the row is stored as `DRAFT`. The academy's
   countersignature (from `brand.signer`) is stamped at creation: creating the agreement is the
   approval act.
2. **Send.** With `send: true` the signer (`signerEmail` or the event contact) receives an email
   with `https://hub.example.com/agreements/<token>`, and the row moves to `SENT`. If mail fails
   the row stays `DRAFT` and the API returns 502 with the token and signing URL.
3. **Sign.** `/agreements/[token]` (noindex) renders the document split at the single
   `[[signature-block]]` marker (`agreementDocument.ts`) and collects any organizer fields. `POST
   /api/agreements/[token]/sign` (10 attempts per IP per hour) requires `agreed: true`, a name,
   a valid email, a typed signature and every marker re-derived from the stored `contentMd`. It
   flips `DRAFT`/`SENT` to `SIGNED` atomically (409 if already signed, 404 if `VOID` or unknown),
   records IP and user agent, grants the signer's account the `EVENT_ORGANIZER` role (creating a
   `STUDENT` + `EVENT_ORGANIZER` user if needed), and emails the executed copy to the signer and
   `INTERNAL_NOTIFICATION_EMAIL`. Role grant and email are best-effort after the signature.
4. **Pay.** For an unpaid `PAID_RENTAL` with a payment link, the sign response carries the link
   with `prefilled_email`, and the page redirects there after 1.5 seconds. The Payment Link was
   created with an `after_completion` redirect to `/agreements/<token>?paid=1`, so the organizer
   lands back on the agreement, which shows a confirmation or processing state.

## Rental payment links

`venueRentalPayment.ts` creates a one-off Stripe Price for the fee (`feeCents`, required, > 0)
and, if `depositCents > 0`, a second "Refundable security deposit" Price, both capped at
$100,000, then a Payment Link with `metadata.kind = "venue_rental"` and `venueEventId` on both the
link and the PaymentIntent. If the event already has a non-`VOID` agreement, the link redirects
back to it; otherwise Stripe's hosted confirmation is shown.

Issuing is refused unless `dealType` is `PAID_RENTAL`, the rental is not already `paid`, and no
link exists yet (409: deactivate first). Issuing stores fee, deposit, link id and URL on the event,
sets `rentalPaymentStatus: "pending"`, and creates a pending `Payment` placeholder
(`venueRentalRecord.ts`, `stripeSessionId: null`, amount = fee + deposit, buyer seeded from the
event contact) so the charge shows on `/admin/sales` and the organizer's `/purchases`.

Deactivating sets the Stripe link inactive (a link already missing in Stripe is tolerated), clears
the five rental fields, and marks unclaimed pending placeholders `failed`. A paid rental cannot be
deactivated.

**Webhook fulfilment** (`checkout.session.completed`, see [PAYMENTS.md](./PAYMENTS.md)): a session
is treated as a rental if its `Payment` row has a `venueEventId`, if its metadata says
`venue_rental`, or, as a fallback for links created outside the hub, if its `payment_link` matches
an event's `rentalPaymentLinkId`. `recordVenueRentalPayment` then, in one transaction, updates the
row for that session id, or claims the pending placeholder for that link, or creates a new `paid`
row, and sets `rentalPaymentStatus: "paid"`. Rentals are excluded from course conversion reporting.
On `charge.refunded` only a full refund marks the payment and the event `refunded`; a
deposit-only partial refund changes nothing. `scripts/backfill-venue-rental-payments.ts` reuses
the same recorder.

## Public pages, registrations and waivers

- `/calendar` is public and indexable. `PublicVenueCalendar` loads `GET
  /api/public/venue-calendar?month=YYYY-MM`, which returns `busy` (public cohort sessions),
  `events` (`APPROVED`, expanded across multi-day ranges) and `tentative` (`PENDING`, date and time
  only). It is cached `s-maxage=300` and reads no cookies.
- Staff see who holds each slot on the dashboard calendar via `GET
  /api/venue-calendar/pending?month=YYYY-MM` (`ADMIN`, `TEAM_MEMBER`; `private, no-store`). It is
  a separate route so a shared cache can never leak booking names to anonymous visitors.
- `/events` lists upcoming `APPROVED` events (start or end date today or later). `/events/[slug]`
  renders `APPROVED` and `CANCELLED` events; anything else is a 404.
- `/events/[slug]/event.ics` serves a single-VEVENT RFC 5545 file for `APPROVED` events only, with
  UTC stamps from `venueEventTime.ts`, `UID` of `<slug>@<hub domain>`, and location "Online" for
  online events (`venueEventIcs.ts`).
- `POST /api/public/venue-events/[slug]/register` `{ name, email, phone?, waiverAccepted }` (10
  per slug per IP per hour) accepts only `APPROVED` events without an `externalRegistrationUrl`.
  In-person events (`isOnline: false`) require `waiverAccepted: true` and store
  `waiverAcceptedAt` plus `WAIVER_VERSION`. A positive `ticketPriceCents` yields
  `PENDING_PAYMENT` and the confirmation email points at `ticketPaymentLink`; otherwise
  `CONFIRMED`. `capacity` counts `CONFIRMED` and `PENDING_PAYMENT` rows (409 when full). The route
  upserts the `Contact` (source `venue-event:{slug}`, tag `venue-event-registrant`) and logs a
  `VENUE_EVENT_REGISTER` event ([LEADS.md](./LEADS.md)). Nothing flips `PENDING_PAYMENT` to
  `CONFIRMED` automatically; ticket links are external.
- `/waiver` renders `src/content/legal/visitor-waiver.md` (`waiver.ts`). Bump `WAIVER_VERSION`
  whenever the text changes so stored acceptances stay attributable.

## Organizer email

`venueOrganizerEmail.ts` composes a plain-text note with the signing link (unless signed), the
payment link (unless paid), and next steps, kept under 1,400 characters, plus warnings when the
agreement or link is missing. **Nothing sends it.** `OrganizerEmailPanel` shows an editable draft
and a Gmail compose deep link so staff send from their own mailbox.

## Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/public/venue-events` | public, rate limited | Booking request, creates `PENDING` |
| `GET /api/public/venue-calendar` | public | Month availability |
| `POST /api/public/venue-events/[slug]/register` | public, rate limited | Attendee registration |
| `GET /api/venue-calendar/pending` | `ADMIN`, `TEAM_MEMBER` | Named pending holds |
| `GET /api/admin/venue-events` | `ADMIN`, `TEAM_MEMBER` | List (`status` default `PENDING`, `from`, `to`, `q`) with latest agreement |
| `PATCH /api/admin/venue-events/[id]` | `ADMIN`, `TEAM_MEMBER` | Edit, change status, `sendDeclineEmail`, `resyncGcal` |
| `POST /api/admin/venue-events/[id]/agreement` | `ADMIN`, `TEAM_MEMBER` | Create agreement, optional `send` |
| `POST`, `DELETE /api/admin/venue-events/[id]/rental-payment` | `ADMIN`, `TEAM_MEMBER` | Issue or deactivate payment link |
| `POST /api/agreements/[token]/sign` | token, rate limited | Sign |
| `GET/POST/PATCH /api/internal/mcp/v1/venue-events` | MCP token | List/detail (`?registrations=true` for the roster), create, update by `id` or `slug` |
| `POST /api/internal/mcp/v1/venue-events/agreement` | MCP token | `{ venueEventId, templateKey?, variables?, send?, signerEmail? }` |
| `POST`, `DELETE /api/internal/mcp/v1/venue-events/rental-payment` | MCP token | `{ venueEventId, feeCents, depositCents? }` / `{ venueEventId }` |

MCP writes return 403 unless `HUB_MCP_WRITES_ENABLED` is `"true"` ([../MCP_API.md](../MCP_API.md)).
Rental-payment routes return 503 when `STRIPE_SECRET_KEY` is unset.

## Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | env | Payment links and fulfilment |
| `GOOGLE_CALENDAR_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ORGANIZER_EMAIL` | env | Calendar sync; skipped when unset |
| `INTERNAL_NOTIFICATION_EMAIL` | env | Staff copy of requests and signed agreements; defaults to `brand.email.contact` |
| `HUB_MCP_TOKEN`, `HUB_MCP_WRITES_ENABLED` | see [../MCP_API.md](../MCP_API.md) | MCP access and write switch |

Venue name, address, countersigner, timezone and URLs come from `src/config/brand.ts`.

## Operational notes and gotchas

- **Sending an agreement and approving an event are consequential.** `send: true` emails a
  binding document already countersigned on the academy's behalf. `APPROVED` publishes the event
  page, opens registration and, with Google Calendar configured, sends the organizer an invite.
- **MCP create defaults to `APPROVED`**, unlike the public form and the column default. Pass
  `status: "PENDING"` for anything not yet confirmed. MCP create and PATCH do not send the hub's
  confirmation email (only the admin PATCH does), but the calendar invite still goes out.
- **There is no void, cancel or delete endpoint** for agreements, events or registrations. No code
  path sets `VOID`; it can only be set directly in the database, after which the token 404s. A
  wrongly sent agreement link stays signable until then. Use `CANCELLED` or `DECLINED` for events.
- Only one payment link per event at a time; deactivate before re-issuing with a new amount.
- A venue request overwrites an existing contact's `source` with `venue-calendar`.
- `endTime` not after `startTime` falls back to a one-hour calendar event.
- The waiver text is marked as a draft pending legal review; have counsel review it before use.

## Key files

| File | Role |
|------|------|
| `src/app/(dashboard)/calendar/page.tsx` | Public venue calendar page and JSON-LD |
| `src/components/venue/PublicVenueCalendar.tsx`, `VenueRequestModal.tsx` | Calendar UI and request form |
| `src/app/api/public/venue-events/route.ts` | Booking request |
| `src/app/api/public/venue-calendar/route.ts`, `src/app/api/venue-calendar/pending/route.ts` | Public and staff month feeds |
| `src/lib/venueCalendarRange.ts` | Month range and multi-day expansion |
| `src/app/(marketing)/events/` | Listing, event page, ICS route |
| `src/app/api/public/venue-events/[slug]/register/route.ts` | Registration |
| `src/lib/waiver.ts`, `src/app/(dashboard)/waiver/page.tsx` | Waiver text, version, page |
| `src/lib/agreementTemplates.ts`, `agreementDocument.ts`, `src/content/agreements/` | Templates and rendering |
| `src/app/agreements/[token]/page.tsx`, `src/components/venue/AgreementSigningDocument.tsx` | Signing page |
| `src/app/api/agreements/[token]/sign/route.ts` | Signing endpoint |
| `src/lib/aisaSignature.ts`, `src/lib/signatureSvg.ts` | Countersignature image, typed-signature SVG |
| `src/lib/venueAgreementLookup.ts`, `venueAgreementPayment.ts` | Latest agreement, post-sign payment URL |
| `src/lib/venueRentalPayment.ts`, `venueRentalRecord.ts` | Payment links, placeholders, webhook recorder |
| `src/lib/venueEventIcs.ts`, `venueEventTime.ts` | ICS writer and wall-clock to UTC |
| `src/lib/venueOrganizerEmail.ts` | Organizer email draft |
| `src/lib/googleCalendar.ts` | Calendar sync |
| `src/app/(dashboard)/admin/venue-events/` | Admin list, drawer, agreement, payment, email panels |
| `src/app/api/admin/venue-events/` | Admin API |
| `src/app/api/internal/mcp/v1/venue-events/` | MCP API |

Tests: `bun test tests/unit` (`agreementTemplates`, `agreementDocument`, `venueAgreementPayment`,
`venueRentalPaymentLinkParams`, `venueRentalRecord`, `venueCalendarRange`, `venueEventContent`,
`venueEventTime`, `venueEventRegisterContact`, `venueOrganizerEmail`).

Related: [PAYMENTS.md](./PAYMENTS.md), [LEADS.md](./LEADS.md), [USER_ROLES.md](./USER_ROLES.md),
[../MCP_API.md](../MCP_API.md), [../ENVIRONMENT.md](../ENVIRONMENT.md).
