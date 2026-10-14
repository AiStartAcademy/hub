// src/lib/purchases.ts
//
// Read-side view of money. The Stripe webhook (src/app/api/webhooks/stripe/route.ts)
// is the ONLY writer of Payment/Membership rows — nothing here mutates. This module
// exists to unify the two payment shapes the hub sells:
//
//   Payment    — one-time cohort seat purchase   (pending | paid | failed | refunded)
//   Membership — recurring subscription          (pending | active | past_due | canceled)
//
// into a single `Purchase` shape both the student page (/purchases) and the admin
// sales list (/admin/sales) render, plus the revenue arithmetic that must not lie.

import {
  MEMBERSHIP_TIER_CONFIG,
  type MembershipTier,
} from "@/lib/membershipTiers";
import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";

export type PurchaseKind = "COHORT" | "MEMBERSHIP" | "VENUE_RENTAL";

/** Normalized cross-model status. Payment and Membership use different
 *  vocabularies for the same underlying facts; this is the union we render. */
export type PurchaseStatus =
  | "paid" // one-time payment collected
  | "active" // subscription in good standing
  | "pending" // checkout started, money not collected
  | "past_due" // subscription payment failed, still active
  | "failed" // checkout abandoned/expired or async payment failed
  | "refunded" // money returned
  | "canceled"; // subscription ended

export type Purchase = {
  id: string;
  kind: PurchaseKind;
  /** Human-readable description of what was bought. */
  title: string;
  /** Seat tier for cohort purchases; membership label for subscriptions. */
  tier: string | null;
  status: PurchaseStatus;
  /** Integer cents, exactly as charged. Never a float. */
  amount: number;
  currency: string;
  purchasedAt: Date;
  /** Subscriptions only: when the paid period ends. */
  currentPeriodEnd: Date | null;
  // --- buyer identity (admin view; a student only ever sees their own) ---
  userId: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  // --- marketing context captured at checkout ---
  attribution: Record<string, string>;
  segment: string | null;
  cohortId: string | null;
  /** Null for venue rental placeholders that no Checkout Session has claimed yet. */
  stripeSessionId: string | null;
  /**
   * Set by the Stripe webhook when a previously-expired checkout is completed
   * through Stripe's recovery flow — i.e. this sale came back from an abandoned
   * cart. Memberships have no recovery flow and are always null.
   */
  recoveredAt: Date | null;
  /** Hub coupon pre-applied at checkout, denormalized onto the row for reporting. */
  couponCode: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors the webhook's normalizeEmail so the identity we match on here is
 *  byte-identical to the one the webhook stored. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase().slice(0, 320);
  return EMAIL_PATTERN.test(email) ? email : null;
}

/** Statuses that represent money actually collected and kept. */
const COLLECTED: PurchaseStatus[] = ["paid", "active"];
/** Statuses where a checkout exists but no money has been collected. */
const PENDING: PurchaseStatus[] = ["pending"];

export function isCollected(status: PurchaseStatus): boolean {
  return COLLECTED.includes(status);
}

/** True only for a completed purchase. A `pending` row is a started checkout,
 *  NOT a purchase — rendering it as one would tell a student they bought
 *  something they never paid for. */
export function isCompleted(purchase: Purchase): boolean {
  return isCollected(purchase.status) || purchase.status === "refunded";
}

/** Formats integer cents for display. Takes cents and divides once at the
 *  boundary — money is never carried through arithmetic as a float. */
export function formatAmount(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Payment.status is already our vocabulary; guard anything unexpected into
 *  `pending` rather than trusting a stray value into the revenue math. */
function paymentStatus(raw: string): PurchaseStatus {
  switch (raw) {
    case "paid":
    case "failed":
    case "refunded":
    case "pending":
      return raw;
    default:
      return "pending";
  }
}

function membershipStatus(raw: string): PurchaseStatus {
  switch (raw) {
    case "active":
    case "past_due":
    case "canceled":
    case "pending":
      return raw;
    default:
      return "pending";
  }
}

type PaymentRow = {
  id: string;
  userId: string | null;
  cohortId: string | null;
  venueEventId: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  attribution: string | null;
  segment: string | null;
  stripeSessionId: string | null;
  amount: number;
  currency: string;
  status: string;
  recoveredAt: Date | null;
  couponCode: string | null;
  createdAt: Date;
  cohort: { title: string } | null;
  venueEvent: { title: string; slug: string } | null;
  group: { name: string } | null;
};

type MembershipRow = {
  id: string;
  userId: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  attribution: string | null;
  segment: string | null;
  stripeSessionId: string;
  amount: number;
  currency: string;
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
  createdAt: Date;
};

function isMembershipTier(value: string): value is MembershipTier {
  return value in MEMBERSHIP_TIER_CONFIG;
}

export function paymentToPurchase(row: PaymentRow): Purchase {
  if (row.venueEventId) {
    return {
      id: row.id,
      kind: "VENUE_RENTAL",
      title: `Venue rental — ${row.venueEvent?.title ?? "event"}`,
      tier: null,
      status: paymentStatus(row.status),
      amount: row.amount,
      currency: row.currency,
      purchasedAt: row.createdAt,
      currentPeriodEnd: null,
      userId: row.userId,
      buyerEmail: row.buyerEmail,
      buyerName: row.buyerName,
      attribution: safeJson<Record<string, string>>(row.attribution, {}),
      segment: row.segment,
      cohortId: null,
      stripeSessionId: row.stripeSessionId,
      recoveredAt: row.recoveredAt,
      couponCode: row.couponCode,
    };
  }

  return {
    id: row.id,
    kind: "COHORT",
    title: row.cohort?.title ?? "Cohort seat",
    tier: row.group?.name ?? null,
    status: paymentStatus(row.status),
    amount: row.amount,
    currency: row.currency,
    purchasedAt: row.createdAt,
    currentPeriodEnd: null,
    userId: row.userId,
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    attribution: safeJson<Record<string, string>>(row.attribution, {}),
    segment: row.segment,
    cohortId: row.cohortId,
    stripeSessionId: row.stripeSessionId,
    recoveredAt: row.recoveredAt,
    couponCode: row.couponCode,
  };
}

export function membershipToPurchase(row: MembershipRow): Purchase {
  const tierConfig = isMembershipTier(row.tier)
    ? MEMBERSHIP_TIER_CONFIG[row.tier]
    : null;

  return {
    id: row.id,
    kind: "MEMBERSHIP",
    title: tierConfig?.productName ?? brand.products.membership,
    tier: tierConfig?.label ?? row.tier ?? null,
    status: membershipStatus(row.status),
    amount: row.amount,
    currency: row.currency,
    purchasedAt: row.createdAt,
    currentPeriodEnd: row.currentPeriodEnd,
    userId: row.userId,
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    attribution: safeJson<Record<string, string>>(row.attribution, {}),
    segment: row.segment,
    cohortId: null,
    stripeSessionId: row.stripeSessionId,
    // Subscriptions have no expired-session recovery flow and no coupon column.
    recoveredAt: null,
    couponCode: null,
  };
}

const PAYMENT_SELECT = {
  id: true,
  userId: true,
  cohortId: true,
  venueEventId: true,
  buyerEmail: true,
  buyerName: true,
  attribution: true,
  segment: true,
  stripeSessionId: true,
  amount: true,
  currency: true,
  status: true,
  recoveredAt: true,
  couponCode: true,
  createdAt: true,
  cohort: { select: { title: true } },
  venueEvent: { select: { title: true, slug: true } },
  group: { select: { name: true } },
} as const;

const MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  buyerEmail: true,
  buyerName: true,
  attribution: true,
  segment: true,
  stripeSessionId: true,
  amount: true,
  currency: true,
  tier: true,
  status: true,
  currentPeriodEnd: true,
  createdAt: true,
} as const;

function byNewestFirst(a: Purchase, b: Purchase): number {
  return b.purchasedAt.getTime() - a.purchasedAt.getTime();
}

/**
 * Every purchase belonging to one person, newest first.
 *
 * Identity is `userId OR buyerEmail` — deliberately NOT `userId` alone. Guest
 * checkout creates rows with `userId: null` (the webhook backfills it on
 * success, but pending/failed guest rows never get one), and the Payment→User
 * relation is `onDelete: SetNull`, so historical rows can be orphaned later.
 * Matching on userId alone would show a paying customer an empty page.
 *
 * Email matching is safe precisely because `User.email` is unique: the caller
 * passes the *session's own* email, so this can only ever widen to rows the
 * signed-in person actually bought. Callers must never pass a client-supplied
 * email — see the route handlers, which read it off the session.
 */
export async function getUserPurchases(
  userId: string | null | undefined,
  email: string | null | undefined
): Promise<Purchase[]> {
  const normalized = normalizeEmail(email);

  // No identity, no rows. Returning [] rather than an unfiltered query is the
  // difference between an empty page and a full data leak.
  if (!userId && !normalized) return [];

  // Stored buyerEmail is NOT reliably lowercase. The checkout route normalizes,
  // but the webhook writes `buyerEmail: existingUser.email` verbatim (see
  // api/webhooks/stripe/route.ts), and /api/register stores the submitted email
  // without lowercasing — so a mixed-case User.email propagates into the row.
  // Match both the normalized form and the session's own casing. (Prisma's
  // `mode: "insensitive"` is Postgres-only and this schema is on SQLite.)
  const raw = typeof email === "string" ? email.trim().slice(0, 320) : null;
  const emailCandidates = Array.from(
    new Set([normalized, raw].filter((e): e is string => Boolean(e)))
  );

  const identity = [
    ...(userId ? [{ userId }] : []),
    ...(emailCandidates.length ? [{ buyerEmail: { in: emailCandidates } }] : []),
  ];

  // Venue rental organizers: the event's contactEmail identifies the payer even
  // when the Stripe Checkout email (→ buyerEmail) was typed differently, so an
  // organizer with a hub account sees their rental on /purchases. Payments
  // only — Membership has no venue relation.
  const paymentIdentity = [
    ...identity,
    ...(emailCandidates.length
      ? [{ venueEvent: { contactEmail: { in: emailCandidates } } }]
      : []),
  ];

  const [payments, memberships] = await Promise.all([
    prisma.payment.findMany({
      where: { OR: paymentIdentity },
      select: PAYMENT_SELECT,
      orderBy: { createdAt: "desc" },
    }),
    prisma.membership.findMany({
      where: { OR: identity },
      select: MEMBERSHIP_SELECT,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return [
    ...payments.map(paymentToPurchase),
    ...memberships.map(membershipToPurchase),
  ].sort(byNewestFirst);
}

/** Every transaction in the system, newest first. Admin surfaces only —
 *  callers are responsible for the role check before invoking this. */
export async function getAllPurchases(): Promise<Purchase[]> {
  const [payments, memberships] = await Promise.all([
    prisma.payment.findMany({
      select: PAYMENT_SELECT,
      orderBy: { createdAt: "desc" },
    }),
    prisma.membership.findMany({
      select: MEMBERSHIP_SELECT,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return [
    ...payments.map(paymentToPurchase),
    ...memberships.map(membershipToPurchase),
  ].sort(byNewestFirst);
}

export type SalesTotals = {
  /** Cents actually collected — `paid` and `active` rows only. */
  collectedCents: number;
  /** Cents returned to buyers. Reported separately, never netted silently. */
  refundedCents: number;
  /** Cents in started-but-unpaid checkouts. NOT revenue. */
  pendingCents: number;
  /** collected − refunded. The number that is true. */
  netCents: number;
  /**
   * Cents collected from carts that were abandoned and then recovered through
   * Stripe's expired-session recovery flow. A SUBSET of collectedCents, never an
   * addition to it — this is the answer to "did cart recovery earn its keep",
   * and double-counting it into revenue would be the exact lie this module exists
   * to prevent.
   */
  recoveredCents: number;
  collectedCount: number;
  refundedCount: number;
  pendingCount: number;
  failedCount: number;
  recoveredCount: number;
  totalCount: number;
};

/**
 * Revenue arithmetic. The whole point of this function is that `pending` and
 * `failed` rows sit in the same table as real sales — summing `amount` across
 * the table produces a number that overstates revenue and would be quoted as
 * fact. Collected, refunded, and pending are three separate business facts and
 * are reported as three separate figures.
 */
export function computeSalesTotals(purchases: Purchase[]): SalesTotals {
  let collectedCents = 0;
  let refundedCents = 0;
  let pendingCents = 0;
  let collectedCount = 0;
  let refundedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let recoveredCents = 0;
  let recoveredCount = 0;

  for (const p of purchases) {
    if (isCollected(p.status)) {
      collectedCents += p.amount;
      collectedCount += 1;
      // Counted inside the collected branch on purpose: a recovered sale is a
      // collected sale, so it can never be recorded unless the money landed.
      if (p.recoveredAt) {
        recoveredCents += p.amount;
        recoveredCount += 1;
      }
    } else if (p.status === "refunded") {
      refundedCents += p.amount;
      refundedCount += 1;
    } else if (PENDING.includes(p.status)) {
      pendingCents += p.amount;
      pendingCount += 1;
    } else {
      // failed | past_due | canceled — no money currently held, not pending either.
      failedCount += 1;
    }
  }

  return {
    collectedCents,
    refundedCents,
    pendingCents,
    netCents: collectedCents - refundedCents,
    recoveredCents,
    collectedCount,
    refundedCount,
    pendingCount,
    failedCount,
    recoveredCount,
    totalCount: purchases.length,
  };
}
