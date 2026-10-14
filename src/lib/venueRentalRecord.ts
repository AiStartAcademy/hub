// Records a paid venue rental Checkout Session as a Payment row and flips the
// event's denormalized rentalPaymentStatus. Shared by the Stripe webhook and
// the backfill script (scripts/backfill-venue-rental-payments.ts) so both
// paths write identically and idempotently.
//
// Reconciliation order:
//   1. A pending placeholder row (created at payment-link issue time with
//      stripeSessionId: null) matching this event's payment link is claimed
//      and updated in place.
//   2. Otherwise upsert by stripeSessionId — covers webhook retries and extra
//      completions of the same multi-use payment link.

import type Stripe from "stripe";
import prisma from "@/lib/prisma";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase().slice(0, 320);
  return EMAIL_PATTERN.test(email) ? email : null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function checkoutSessionPaymentLinkId(
  checkoutSession: Stripe.Checkout.Session
): string | null {
  return trimToNull(
    typeof checkoutSession.payment_link === "string"
      ? checkoutSession.payment_link
      : checkoutSession.payment_link?.id
  );
}

/**
 * Data for the pending Payment placeholder created alongside a new rental
 * payment link. `stripeSessionId` stays null until the webhook claims the row
 * for the completed Checkout Session; buyer identity is seeded from the venue
 * event's contact so the organizer sees the pending charge on /purchases.
 */
export function buildPendingVenueRentalPayment(options: {
  venueEventId: string;
  paymentLinkId: string;
  feeCents: number;
  depositCents: number;
  contactEmail: string | null;
  organizerName: string | null;
}) {
  return {
    venueEventId: options.venueEventId,
    stripePaymentLinkId: options.paymentLinkId,
    buyerEmail: normalizeEmail(options.contactEmail),
    buyerName: trimToNull(options.organizerName),
    amount: options.feeCents + Math.max(options.depositCents, 0),
    currency: "usd",
    status: "pending",
  };
}

/**
 * Idempotently records a paid venue rental Checkout Session.
 *
 * `venueEventId` may be passed explicitly for sessions whose payment link was
 * created outside the hub (no `venueEventId` metadata) but was matched to a
 * VenueEvent via `rentalPaymentLinkId`. When omitted, the session's own
 * metadata must carry it.
 */
export async function recordVenueRentalPayment(
  checkoutSession: Stripe.Checkout.Session,
  options: { venueEventId?: string } = {}
): Promise<void> {
  const stripeSessionId = trimToNull(checkoutSession.id);
  if (!stripeSessionId) {
    throw new Error("Stripe Checkout Session missing id");
  }

  const venueEventId =
    trimToNull(options.venueEventId) ??
    trimToNull(checkoutSession.metadata?.venueEventId);
  if (!venueEventId) {
    throw new Error(
      `Checkout Session ${stripeSessionId} missing required metadata.venueEventId`
    );
  }

  const venueEvent = await prisma.venueEvent.findUnique({
    where: { id: venueEventId },
    select: { id: true },
  });
  if (!venueEvent) {
    throw new Error(
      `Checkout Session ${stripeSessionId} references missing venue event ${venueEventId}`
    );
  }

  if (!isNonNegativeInteger(checkoutSession.amount_total)) {
    throw new Error(
      `Checkout Session ${stripeSessionId} has invalid amount_total ${String(checkoutSession.amount_total)}`
    );
  }
  const amount = checkoutSession.amount_total;

  const currency = trimToNull(checkoutSession.currency)?.toLowerCase();
  if (!currency) {
    throw new Error(`Checkout Session ${stripeSessionId} missing currency`);
  }

  const rawPaymentIntent =
    typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : checkoutSession.payment_intent?.id;
  const stripePaymentIntentId = trimToNull(rawPaymentIntent);
  if (rawPaymentIntent && !stripePaymentIntentId) {
    throw new Error(
      `Checkout Session ${stripeSessionId} carried an invalid payment_intent id`
    );
  }

  const buyerEmail = normalizeEmail(
    checkoutSession.customer_details?.email ?? checkoutSession.customer_email
  );
  const buyerName = trimToNull(checkoutSession.customer_details?.name);
  const stripePaymentLinkId = checkoutSessionPaymentLinkId(checkoutSession);

  const user = buyerEmail
    ? await prisma.user.findUnique({
        where: { email: buyerEmail },
        select: { id: true },
      })
    : null;

  await prisma.$transaction(async (tx) => {
    // Already recorded for this session (webhook retry) → update in place.
    const existing = await tx.payment.findUnique({
      where: { stripeSessionId },
      select: { id: true },
    });

    // Placeholder created at link-issue time, not yet claimed by any session.
    const placeholder = existing
      ? null
      : await tx.payment.findFirst({
          where: {
            venueEventId: venueEvent.id,
            stripeSessionId: null,
            status: "pending",
            ...(stripePaymentLinkId ? { stripePaymentLinkId } : {}),
          },
          select: { id: true },
        });

    const paidData = {
      stripeSessionId,
      status: "paid",
      amount,
      currency,
      ...(stripePaymentLinkId ? { stripePaymentLinkId } : {}),
      ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
      ...(user ? { userId: user.id } : {}),
      ...(buyerEmail ? { buyerEmail } : {}),
      ...(buyerName ? { buyerName } : {}),
    };

    if (existing) {
      await tx.payment.update({ where: { id: existing.id }, data: paidData });
    } else if (placeholder) {
      await tx.payment.update({ where: { id: placeholder.id }, data: paidData });
    } else {
      await tx.payment.create({
        data: {
          stripeSessionId,
          stripePaymentLinkId,
          stripePaymentIntentId,
          userId: user?.id ?? null,
          cohortId: null,
          venueEventId: venueEvent.id,
          buyerEmail,
          buyerName,
          amount,
          currency,
          status: "paid",
        },
      });
    }

    await tx.venueEvent.update({
      where: { id: venueEvent.id },
      data: { rentalPaymentStatus: "paid" },
    });
  });
}
