# Members Area

The paid-membership surface: tiered entitlements, the `/members` pages, self-service billing,
accountability pods, a milestone ladder, member calls, a template library, and a Rocket.Chat
community. Memberships are sold through Stripe subscription Checkout; see
[PAYMENTS.md](./PAYMENTS.md) for checkout and the webhook, [CHAT.md](./CHAT.md) for Rocket.Chat,
and [USER_ROLES.md](./USER_ROLES.md) for roles.

## Tiers — `src/lib/membershipTiers.ts`

Two tiers, keyed by the value stored in `Membership.tier`:

| Key | Rank | Price |
|---|---|---|
| `MENTOR_NETWORK` | 1 (entry) | `amountCents` in the tier config, or the Price in `STRIPE_MEMBERSHIP_RECORDINGS_PRICE_ID` |
| `ACCELERATOR` | 2 (superset) | `amountCents`, or `STRIPE_MEMBERSHIP_ACCELERATOR_PRICE_ID` |

`MEMBERSHIP_TIER_CONFIG` holds each tier's label, card copy, features, configured price and the
name of its price-id secret. It is a plain data module, safe to import from client components.
Price ids are read with `getSecret` (Admin → Integrations, env fallback). The tier keys are stored
values: rename labels freely, but changing a key needs a data migration.

## Entitlements — `src/lib/entitlements.ts`

The single place that answers "what does this member get". Nothing else should query
`Membership` for an access decision.

- `getMembershipSnapshot(userId)` → `{ tier, status, isMember, inGrace, ... }`. Considers
  `active` and `past_due` rows; `past_due` counts for `GRACE_DAYS` (7) after `currentPeriodEnd`.
  Active beats past-due, then the higher tier wins (a user can hold several rows).
- `tierAtLeast(snap, minTier)` — `null` or unknown minimum means any member.
- `hasEntitlement(snap, key, roles)` — staff (`MANAGE_ROLES`) bypass every gate.
- `getMembershipEntitlements(userId, roles)` — snapshot plus the full key map.

| Entitlement | Minimum tier |
|---|---|
| `recordings`, `community`, `weeklyQa` | `MENTOR_NETWORK` |
| `memberLibrary`, `pod`, `coachingCalls`, `dealDesk`, `buildSprint`, `milestoneLadder` | `ACCELERATOR` |

Course gating with `Program.accessMode = "member"` (optionally narrowed by
`Program.memberMinTier`) goes through the same snapshot — see [COURSE_ACCESS.md](./COURSE_ACCESS.md).
`hasAcceleratorAccess(userId)` in `src/lib/programAccess.ts` is the narrow check used for 1:1
mentor booking on instructor profiles ([HUMANS.md](./HUMANS.md)).

## Data model

| Model | Purpose |
|---|---|
| `Membership` | subscription or comp row (see [PAYMENTS.md](./PAYMENTS.md)) |
| `Pod` / `PodMember` | accountability groups (`forming / active / archived`, `capacity`, optional coach and source cohort), each with a private Rocket.Chat group. `PodMember.leftAt` is set instead of deleting. |
| `Milestone` / `MilestoneAchievement` | the ladder; rungs come from `ensureMilestones()` in `src/lib/milestones.ts`. Members self-report (`pending`), staff verify. |
| `MemberEvent` | member calls: `COACHING`, `DEAL_DESK`, `BUILD_SPRINT`, `WEEKLY_QA`, with `minTier` and optional `podId`. Deliberately separate from `CohortSession`, which carries Zoom occurrence sync. |
| `MemberResource` | template/workflow library, `minTier` gated, `published` flag. Locked rows are returned without their `url`. |

**Mirrored cohort sessions.** A cohort with `Cohort.memberEventType` set (cohort form checkbox
"Show sessions in Member Calls as Weekly Q&A") has its `CohortSession` rows merged into the member
call lists (`src/lib/memberEvents.ts`) as `cs:<sessionId>` items. Join links resolve through
`resolveJoinLink` (session link, then cohort link), recordings come from
`CohortSession.recordingLink`.

**Course calls.** Buyers of a program with `includesWeeklyCalls` see `WEEKLY_QA` calls on
`/members/calls` for `COURSE_CALL_WINDOW_DAYS` (90) after purchase (`hasCourseCallAccess` in
`src/lib/selfPaced.ts`), without a membership.

## Writer invariant

The Stripe webhook is the **only writer of paid membership state**. Admin comps are `Membership`
rows with `stripeSessionId = "comp_<uuid>"` and `amount: 0`, which the webhook can never match
(`src/lib/membershipAdmin.ts`). Only comp rows can be revoked locally; paid rows are canceled in
Stripe and the `customer.subscription.*` webhook syncs them back.

A comp with a month count gets a `currentPeriodEnd`, but the snapshot does not check
`currentPeriodEnd` for `active` rows, so a time-limited comp keeps access until it is revoked.

## Billing self-service

- `POST /api/membership/portal` — Stripe Billing Portal session (cards, invoices, cancel),
  returning to `/settings`. Configure the portal in the Stripe dashboard with plan switching
  disabled; the webhook tier sync makes a portal switch safe anyway.
- `POST /api/membership/change-tier` `{ tier }` — updates the subscription item's price in place
  with prorations and sets `metadata.tier`. Writes nothing locally; returns 503 when the target
  tier has no configured price id.
- `GET /api/membership/me` — read-only state for client panels.
- Settings → Membership panel: `src/components/members/MembershipPanel.tsx`.

## Lifecycle — `src/lib/membershipLifecycle.ts`

`onMembershipActivated(membershipId)` runs from the webhook and from comp grants:

1. Welcome email, idempotent via `Membership.welcomeSentAt`. Failure throws so a Stripe retry
   recovers delivery.
2. Rocket.Chat provisioning (best-effort).
3. If a `Contact` exists for the email, its active drip enrollments are stopped with reason
   `membership_activated` (best-effort). No Contact is created for this.

## Rocket.Chat — `src/lib/memberChat.ts`

A `members-lounge` group for every active member and a `pod-<slug>` group per pod. Members are
created with RC role `user` (cohort students use the channel-capped `guest` role). Provisioning is
fire-and-forget: chat downtime never fails the webhook. The **Sync chat** button on
`/admin/members/pods` repairs drift. `GET /api/members/chat` serves the community page. Requires
`RC_URL`, `RC_ADMIN_USER_ID`, `RC_ADMIN_AUTH_TOKEN`, `RC_PASSWORD_SECRET`
([../ENVIRONMENT.md](../ENVIRONMENT.md)).

## Surfaces

| Route | Notes |
|---|---|
| `/membership` | public landing page with tier cards (`src/components/MembershipPlans.tsx`) |
| `/members` | member home: status, next calls, pod, ladder, library preview; non-members see tier cards; entry-tier members see locked upper-tier sections |
| `/members/library`, `/members/calls`, `/members/milestones`, `/members/pod`, `/members/community` | tier-gated server-side |
| `/admin/members`, `/admin/members/[userId]` | every membership, MRR, comp grant/revoke (`MANAGE_ROLES`; some actions `ADMIN_ROLES`) |
| `/admin/members/pods`, `/admin/members/milestones`, `/admin/members/events` | pods, verification queue, event scheduling |

Agents can list, grant and revoke comps through `/api/internal/mcp/v1/memberships`
(writes gated by `HUB_MCP_WRITES_ENABLED`); see [../MCP_API.md](../MCP_API.md).

## Before launch

- Configure the Stripe Billing Portal (plan switching off).
- Check your Rocket.Chat workspace's guest-account cap if cohort students also use chat.
