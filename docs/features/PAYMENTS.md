# Payments

Stripe Checkout sells three things: cohort seats, self-paced course access, and recurring
memberships. Venue rentals reuse the same `Payment` table. **The signature-verified Stripe
webhook is the only code path that grants access or marks money as collected.** Checkout routes
create `pending` rows; nothing is granted on the browser success redirect.

See also: [MEMBERS_AREA.md](./MEMBERS_AREA.md), [COURSE_ACCESS.md](./COURSE_ACCESS.md),
[COHORTS_PUBLIC.md](./COHORTS_PUBLIC.md), [DRIP_CAMPAIGNS.md](./DRIP_CAMPAIGNS.md),
[../SECURITY.md](../SECURITY.md), [../ENVIRONMENT.md](../ENVIRONMENT.md).

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | env | Server Stripe client (`src/lib/stripe.ts`, constructed lazily so builds work without it). Routes return 500 "Payments are not configured" when unset. |
| `STRIPE_WEBHOOK_SECRET` | env | Webhook signature verification. Read from `process.env` directly. |
| `STRIPE_MEMBERSHIP_RECORDINGS_PRICE_ID`, `STRIPE_MEMBERSHIP_ACCELERATOR_PRICE_ID` | Admin → Integrations (`getSecret`, env fallback) | Optional recurring Price per membership tier. Unset tiers fall back to inline `price_data`. |
| `NEXT_PUBLIC_APP_URL` | env | Base for success/cancel URLs. |

Point a Stripe webhook endpoint at `https://hub.example.com/api/webhooks/stripe` and subscribe
it to the events below.

## Data model

- `Payment` — one-time purchase. Exactly one context: `cohortId` + `groupId` (seat tier),
  `programId` (course), or `venueEventId` (rental). Status `pending | paid | failed | refunded`.
  Carries `buyerEmail`/`buyerName` (guest checkout), `attribution` (JSON first-touch UTM),
  `segment`, `stripeSessionId`, `stripePaymentIntentId`, `amount` (integer cents), `expiresAt`
  (seat hold), `checkoutUrl`, `recoveredAt`, `couponCode`, `accountSetupSentAt`.
- `Membership` — subscription. Status `pending | active | past_due | canceled | expired`, plus
  `tier`, `stripeSubscriptionId`, `stripeCustomerId`, `currentPeriodEnd`, `welcomeSentAt`.
- `Coupon` / `Redemption` — hub-side discount codes mirrored to Stripe (see below).

## Checkout routes

| Route | Sells | Notes |
|---|---|---|
| `POST /api/cohorts/[id]/checkout` `{ groupId, name?, email?, code? }` | cohort seat | Cohort must be `ENROLLMENT`; id or slug accepted. Free (`price <= 0`) groups are refused — use `/api/cohorts/[id]/register-free`. |
| `POST /api/programs/[id]/checkout` | self-paced course | Program must have `priceCents > 0`, `status: "open"` and `locked: false`; 409 if the buyer already has access. |
| `POST /api/membership/checkout` `{ tier?, email?, name?, code? }` | membership | `mode: "subscription"`. `tier` is `MENTOR_NETWORK` (default) or `ACCELERATOR`; anything else is 400. |

All three: guests supply name/email and no account is created; signed-in buyers reuse (or get) a
Stripe customer. An open Checkout Session for the same buyer and item is reused on retry, so
double-clicks never create a second charge. Sessions expire after 30 minutes. Cohort seats count
unexpired pending holds against `Group.seats` (`src/lib/seats.ts`) and return 409 when full.
Attribution, segment and ad click ids ride along in Stripe metadata so the webhook can report a
matched server-side conversion.

## Webhook — `POST /api/webhooks/stripe`

Node runtime, raw body, `stripe.webhooks.constructEvent`. Any handler error returns 500 so Stripe
retries; every write is idempotent.

| Event | Effect |
|---|---|
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | Subscription mode: activate the matching `Membership`, then run the membership lifecycle. Payment mode (only when `payment_status === "paid"`): route on the pre-created `Payment` row — cohort seat (`GroupMember` + `Enrollment` upsert, `source: "stripe"`), program (`ProgramAccess` + `ProgramEnrollment` upsert), or venue rental. Unknown sessions with no hub row and no matching venue Payment Link are acknowledged and ignored. |
| `customer.subscription.updated`, `customer.subscription.deleted` | Sync membership status, `currentPeriodEnd`, `tier` and `amount` by `stripeSubscriptionId`. Tier is resolved from the price id against the managed price-id secrets, falling back to `subscription.metadata.tier`. |
| `checkout.session.async_payment_failed` | `Payment` → `failed`. |
| `checkout.session.expired` | Pending `Payment` → `failed` and its `checkoutUrl` replaced with Stripe's recovery URL; pending `Membership` → `expired`; then an immediate abandoned-cart sync. |
| `charge.refunded` | Only full refunds act. `Payment` → `refunded`; a venue rental is flagged refunded; a course purchase loses its `ProgramAccess` row. Cohort-seat and membership access are left for an admin to revoke. |

Fulfillment trusts only sessions created by the hub's own checkout routes: the Stripe signature
proves the event, the pre-created row proves the price and item. Buyers are found or created by
normalized email (`role: STUDENT`, first-touch attribution preserved). Passwordless accounts get a
one-time `/set-password` link; `accountSetupSentAt` is stamped only after mail succeeds, so a retry
re-sends a failed email without duplicating the grant. CRM side effects (lead marked won, phone
filled from Checkout, cohort reminder enrollment) are best-effort and never fail the webhook.

## Coupons — `src/lib/coupons.ts`, admin at `/admin/coupons`

A hub `Coupon` (`kind` `MANUAL | CAMPAIGN | AFFILIATE`; exactly one of `percentOff`/`amountOff`;
`appliesTo` `all | cohort | membership | program`; optional `cohortId`, `maxRedemptions`,
`expiresAt`, affiliate `ownerUserId` + `commissionPercent`) is mirrored to a Stripe Coupon
(`duration: "once"`) and Promotion Code. Codes are uppercase alphanumerics and dashes.

At checkout a code arrives in the body or via the referral cookie set by `/join/[code]`. If
`validateCode` accepts it, it is pre-applied (`discounts`); otherwise Checkout shows a typed-code
box (`allow_promotion_codes`). Stripe forbids both at once. An affiliate cannot redeem their own
code. `Redemption` rows (one per payment or membership) are written only by the webhook from the
session's discount totals, along with the affiliate commission.

## Cart recovery

Payment-mode sessions are created with `after_expiration.recovery` enabled. On expiry the webhook
stores the recovery URL, and `syncAbandonedCheckouts` (`src/lib/drip/abandoned.ts`, also run by the
drip tick) turns abandoners into tagged `Contact` leads (`checkout-abandoned`,
`program-abandoned`, `membership-abandoned`) for the seeded recovery campaigns, whose
`{{resume_checkout_url}}` links the recovery URL. Buyers are skipped; unsubscribed contacts are
never touched. A completed recovered session (Stripe's `recovered_from`) stamps
`Payment.recoveredAt`.

## Read surfaces — `src/lib/purchases.ts`

| Route | Who | What |
|---|---|---|
| `/purchases` | any signed-in user | their own purchases and memberships |
| `/admin/sales` | `ADMIN`, `TEAM_MEMBER` | every transaction, totals, client-side CSV export |

`getUserPurchases(userId, email)` matches **`userId` OR `buyerEmail`** (and a venue event's
contact email). `getAllPurchases()` returns everything; callers do the role check.
`computeSalesTotals` reports collected (`paid` + `active`), refunded, pending and
`net = collected − refunded` separately; recovered revenue is a subset of collected, never added.

## Gotchas

- **Never match purchases on `userId` alone.** Pending/failed guest rows never get a `userId`, and
  `Payment.user` is `onDelete: SetNull`. Pass the session's email, never a client-supplied one.
- **`buyerEmail` casing is not guaranteed.** Fulfillment copies `User.email`, which the
  registration route stores as submitted. Reads match the normalized and the raw session email.
  The schema is SQLite, so Prisma `mode: "insensitive"` is unavailable.
- **Summing `amount` overstates revenue.** Pending and failed rows share the table.
- **Unknown status strings read as `pending`**, so a `Membership` in `expired` appears as pending
  on the read surfaces.
- **Program purchases render as "Cohort seat"** in `/purchases` and `/admin/sales`: the read
  projection has no program title.
- **Deleting a cohort deletes its payments** (`Payment.cohort` is `onDelete: Cascade`).
- Paid buyers are honored even if a tier is already full; the webhook logs the oversell.

## Tests

`bun test tests/unit` — `purchases.test.ts`, `coupons.test.ts`, `programAccess.test.ts`,
`stripeContactPhone.test.ts`.
