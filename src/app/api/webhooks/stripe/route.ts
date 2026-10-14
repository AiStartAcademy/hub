import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { generateAccountSetupToken } from "@/lib/tokens";
import { sendAccountSetupEmail } from "@/lib/mail";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { getSecret } from "@/lib/secrets";
import { MEMBERSHIP_TIER_CONFIG } from "@/lib/membershipTiers";
import { onMembershipActivated } from "@/lib/membershipLifecycle";
import { onProgramPurchased } from "@/lib/programPurchaseLifecycle";
import {
  checkoutSessionPaymentLinkId,
  recordVenueRentalPayment,
} from "@/lib/venueRentalRecord";
import { syncAbandonedCheckouts } from "@/lib/drip/abandoned";
import { enrollInCohortReminderCampaigns } from "@/lib/drip/cohortAnchor";
import { recordRedemption } from "@/lib/coupons";
import { logger } from "@/lib/logger";
import {
  contextFromStripeMetadata,
  dispatchConversion,
} from "@/lib/serverConversions";
import { markLeadWonForPurchase } from "@/lib/leads/autoWon";
import { fillContactPhoneFromCheckout } from "@/lib/leads/personRecord";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Send the `purchase` / Meta `Purchase` conversion for a paid Checkout Session.
 *
 * The Stripe session id is the dedupe key on both destinations, so Stripe retrying
 * this webhook (which it does on any non-2xx) cannot double-count the sale.
 * Deliberately not awaited: Stripe expects a fast 2xx, and a slow analytics call
 * must never push the handler into a retry.
 */
function reportCheckoutConversion(checkoutSession: Stripe.Checkout.Session): void {
  const email =
    checkoutSession.customer_details?.email ?? checkoutSession.customer_email ?? undefined;
  const cohortId = trimToNull(checkoutSession.metadata?.cohortId);
  const programId = trimToNull(checkoutSession.metadata?.programId);
  let conversionKind = "cohort";
  if (programId) {
    conversionKind = "course";
  }
  if (checkoutSession.mode === "subscription") {
    conversionKind = "membership";
  }
  // amount_total is in the smallest currency unit; GA4 and Meta both want a decimal.
  const value =
    typeof checkoutSession.amount_total === "number"
      ? checkoutSession.amount_total / 100
      : undefined;

  void dispatchConversion(
    {
      name: "purchase",
      eventId: checkoutSession.id,
      value,
      currency: checkoutSession.currency?.toUpperCase() ?? "USD",
      params: {
        conversion_kind: conversionKind,
        cohort_id: cohortId ?? undefined,
        program_id: programId ?? undefined,
      },
    },
    contextFromStripeMetadata(checkoutSession.metadata ?? undefined, {
      email,
      phone: checkoutSession.customer_details?.phone ?? undefined,
    })
  );
}

// Stripe webhooks must run on the Node runtime (raw body + crypto) and never be
// cached. This endpoint is the SOURCE OF TRUTH for granting seats — never grant
// on the browser success redirect.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeConfigured || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook not configured" },
      { status: 500 }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : "Invalid signature"},
      "Webhook signature verification failed:"
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const checkoutSession = event.data.object as Stripe.Checkout.Session;
        const logContactPhoneFailure = (error: unknown): void => {
          logger.error(
            {
              err: error instanceof Error ? error.message : String(error),
              checkoutSessionId: checkoutSession.id,
            },
            "Contact phone fill failed after Checkout completion (non-fatal)"
          );
        };

        // Stripe's phone field carries no TCPA disclosure. Filling a blank CRM
        // field is best-effort and must never interfere with seat fulfillment.
        try {
          void fillContactPhoneFromCheckout({
            buyerEmail:
              checkoutSession.customer_details?.email ??
              checkoutSession.customer_email,
            phone: checkoutSession.customer_details?.phone,
          }).catch((error: unknown) => {
            logContactPhoneFailure(error);
          });
        } catch (error: unknown) {
          logContactPhoneFailure(error);
        }

        if (checkoutSession.mode === "subscription") {
          await grantMembership(checkoutSession);
          await recordMembershipExtras(checkoutSession);
          // Memberships are course revenue too — report them like cohort seats.
          // Same session-id dedupe protects against webhook retries.
          if (checkoutSession.payment_status === "paid") {
            reportCheckoutConversion(checkoutSession);
          }
        } else if (checkoutSession.payment_status === "paid") {
          const stripeSessionId = requireCheckoutSessionId(checkoutSession);
          const payment = await prisma.payment.findUnique({
            where: { stripeSessionId },
            select: { id: true, venueEventId: true, programId: true },
          });

          let isVenueRental = false;

          if (payment?.venueEventId) {
            isVenueRental = true;
            // Retry of an already-recorded venue rental — re-run idempotently
            // (grantSeat would throw on the missing cohort context).
            await recordVenueRentalPayment(checkoutSession, {
              venueEventId: payment.venueEventId,
            });
          } else if (payment?.programId) {
            await grantProgramAccess(checkoutSession);
            await recordCohortPaymentExtras(checkoutSession, payment.id);
          } else if (payment) {
            await grantSeat(checkoutSession);
            await recordCohortPaymentExtras(checkoutSession, payment.id);
          } else if (checkoutSession.metadata?.kind === "venue_rental") {
            isVenueRental = true;
            await recordVenueRentalPayment(checkoutSession);
          } else {
            // No pre-created row and no venue metadata. Payment links minted
            // outside the hub (e.g. manually in the Stripe dashboard) carry no
            // metadata — fall back to matching the session's payment link
            // against a venue event before giving up.
            const paymentLinkId = checkoutSessionPaymentLinkId(checkoutSession);
            const venueEvent = paymentLinkId
              ? await prisma.venueEvent.findFirst({
                  where: { rentalPaymentLinkId: paymentLinkId },
                  select: { id: true },
                })
              : null;

            if (venueEvent) {
              isVenueRental = true;
              await recordVenueRentalPayment(checkoutSession, {
                venueEventId: venueEvent.id,
              });
            } else {
              // Genuinely unknown session (not created by the hub). Ack with
              // 200 — throwing here only makes Stripe retry forever.
              logger.warn(
                { stripeSessionId, paymentLinkId },
                "Ignoring paid Checkout Session with no hub payment record and no matching venue rental link"
              );
              break;
            }
          }

          // Report the sale to GA4 + Meta from here rather than from the browser:
          // Stripe's webhook is already the source of truth for payment, so a
          // conversion recorded here cannot be lost to an ad blocker, a closed tab
          // before the success page renders, or a missing GTM tag. Venue rentals are
          // excluded — they are a separate revenue line, not a course sale, and
          // mixing them would corrupt the course ROAS the ad account optimizes on.
          // The flag (not metadata.kind) is what's checked so link-fallback venue
          // rentals without metadata are excluded too.
          if (!isVenueRental) {
            reportCheckoutConversion(checkoutSession);
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncMembershipStatus(subscription);
        break;
      }

      case "checkout.session.async_payment_failed": {
        const checkoutSession = event.data.object as Stripe.Checkout.Session;
        await prisma.payment.updateMany({
          where: { stripeSessionId: checkoutSession.id },
          data: { status: "failed" },
        });
        break;
      }

      case "checkout.session.expired": {
        const checkoutSession = event.data.object as Stripe.Checkout.Session;
        // Stripe keeps a recovery URL alive after expiry (after_expiration
        // config at session create). Store it over the dead session URL so
        // the cart-recovery drip links a checkout that still works.
        const recoveryUrl =
          checkoutSession.after_expiration?.recovery?.url ?? null;
        await prisma.payment.updateMany({
          where: { stripeSessionId: checkoutSession.id, status: "pending" },
          data: {
            status: "failed",
            ...(recoveryUrl ? { checkoutUrl: recoveryUrl } : {}),
          },
        });
        // Subscription checkouts: park the pending Membership as `expired`
        // (distinct from a real cancel) so the recovery job can find it.
        await prisma.membership.updateMany({
          where: { stripeSessionId: checkoutSession.id, status: "pending" },
          data: { status: "expired" },
        });
        // Materialize the abandoner as a tagged lead immediately instead of
        // waiting for the next drip tick (≤15 min). Fire-and-forget: a sync
        // failure must not 500 the webhook into Stripe's retry loop.
        try {
          await syncAbandonedCheckouts({ limit: 20 });
        } catch (error) {
          logger.warn(
            { err: error instanceof Error ? error.message : String(error) },
            "syncAbandonedCheckouts failed after session expiry"
          );
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        if (
          !isNonNegativeInteger(charge.amount) ||
          !isNonNegativeInteger(charge.amount_refunded)
        ) {
          throw new Error(
            `Refund webhook for charge ${charge.id} carried invalid amounts`
          );
        }

        if (charge.amount_refunded !== charge.amount) {
          // Venue rentals often refund only the deposit; that must not mark the
          // entire booking refunded when the buyer still paid the remaining fee.
          break;
        }

        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;
        if (paymentIntentId) {
          const payment = await prisma.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntentId },
            select: { venueEventId: true, programId: true, userId: true },
          });

          await prisma.payment.updateMany({
            where: { stripePaymentIntentId: paymentIntentId },
            data: { status: "refunded" },
          });
          if (payment?.venueEventId) {
            await prisma.venueEvent.update({
              where: { id: payment.venueEventId },
              data: { rentalPaymentStatus: "refunded" },
            });
          }
          if (payment?.programId && payment.userId) {
            // This is the automated half of the 7-day guarantee: one full refund
            // in Stripe revokes course access. deleteMany makes retries idempotent;
            // staff can re-grant via POST /api/admin/programs/[programId]/access.
            // ProgramEnrollment is deliberately left in place — it is "my courses"
            // bookkeeping, not an entitlement. A course Payment with no reconciled
            // user never reached fulfillment, so it has no access row to revoke.
            await prisma.programAccess.deleteMany({
              where: { programId: payment.programId, userId: payment.userId },
            });
          }
          // Cohort and membership refund access remains a manual/admin policy decision.
        }
        break;
      }

      default:
        break;
    }
  } catch (error) {
    // Return 500 so Stripe retries. All writes below are idempotent.
    logger.error(
      { err: error instanceof Error ? error.message : "Unknown webhook error"},
      `Webhook handler error for ${event.type}:` 
    );
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

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

function requireCheckoutSessionId(checkoutSession: Stripe.Checkout.Session): string {
  const stripeSessionId = trimToNull(checkoutSession.id);
  if (!stripeSessionId) {
    throw new Error("Stripe Checkout Session missing id");
  }
  return stripeSessionId;
}

// Post-fulfillment bookkeeping for a paid cohort or program checkout: true up
// the charged amount when a discount applied, mark recovered carts, and ledger
// the coupon redemption. Separate from fulfillment so a bookkeeping failure
// can never interfere with access granting; each write is idempotent for retries.
async function recordCohortPaymentExtras(
  checkoutSession: Stripe.Checkout.Session,
  paymentId: string
) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { buyerEmail: true, couponCode: true, recoveredAt: true },
    });
    if (!payment) return;

    const amountTotal = checkoutSession.amount_total;
    const discount = checkoutSession.total_details?.amount_discount ?? 0;
    // Stripe stamps `recovered_from` (the original session id) on sessions
    // completed via an after_expiration recovery URL — exact recovery signal.
    const recovered = Boolean(
      (checkoutSession as { recovered_from?: string | null }).recovered_from
    );

    if ((discount > 0 && isNonNegativeInteger(amountTotal)) || (recovered && !payment.recoveredAt)) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          ...(discount > 0 && isNonNegativeInteger(amountTotal)
            ? { amount: amountTotal }
            : {}),
          ...(recovered && !payment.recoveredAt
            ? { recoveredAt: new Date() }
            : {}),
        },
      });
    }

    if (discount > 0) {
      await recordRedemption(checkoutSession, { paymentId }, {
        buyerEmail: payment.buyerEmail,
        couponCode: payment.couponCode,
      });
    }
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error), paymentId },
      "Cohort payment bookkeeping (discount/recovery) failed"
    );
  }
}

// Same bookkeeping for subscription checkouts, keyed by session id.
async function recordMembershipExtras(checkoutSession: Stripe.Checkout.Session) {
  try {
    const membership = await prisma.membership.findUnique({
      where: { stripeSessionId: checkoutSession.id },
      select: { id: true, buyerEmail: true, couponCode: true },
    });
    if (!membership) return;

    const discount = checkoutSession.total_details?.amount_discount ?? 0;
    if (discount > 0) {
      await recordRedemption(
        checkoutSession,
        { membershipId: membership.id },
        { buyerEmail: membership.buyerEmail, couponCode: membership.couponCode }
      );
    }
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "Membership redemption bookkeeping failed"
    );
  }
}

async function grantSeat(checkoutSession: Stripe.Checkout.Session) {
  // Only sessions previously recorded by our checkout endpoint are trusted for
  // fulfillment. Stripe's signature proves the event, while this row proves the
  // session was created for a real hub cohort/tier at a server-calculated price.
  const payment = await prisma.payment.findUnique({
    where: { stripeSessionId: checkoutSession.id },
    include: {
      cohort: { select: { title: true } },
      group: { select: { id: true, cohortId: true, seats: true } },
    },
  });

  if (!payment) {
    throw new Error("No fulfillable payment record for Checkout Session");
  }
  if (!payment.groupId || !payment.group || !payment.cohortId || !payment.cohort) {
    throw new Error(
      `Payment ${payment.id} is missing cohort fulfillment context`
    );
  }
  if (payment.status === "refunded") return;
  if (payment.group.cohortId !== payment.cohortId) {
    throw new Error("Payment cohort/tier mismatch");
  }

  const buyerEmail = normalizeEmail(
    payment.userId
      ? payment.buyerEmail
      : checkoutSession.customer_details?.email ??
          checkoutSession.customer_email ??
          payment.buyerEmail
  );

  let existingUser = payment.userId
    ? await prisma.user.findUnique({
        where: { id: payment.userId },
        select: {
          id: true,
          email: true,
          name: true,
          password: true,
          attribution: true,
          stripeCustomerId: true,
        },
      })
    : buyerEmail
      ? await prisma.user.findUnique({
          where: { email: buyerEmail },
          select: {
            id: true,
            email: true,
            name: true,
            password: true,
            attribution: true,
            stripeCustomerId: true,
          },
        })
      : null;

  if (!existingUser && !buyerEmail) {
    throw new Error("Paid Checkout Session has no valid buyer email");
  }

  if (!existingUser && buyerEmail) {
    // Upsert closes the race if two paid sessions for the same new email are
    // delivered concurrently. The update is intentionally minimal so existing
    // profile data and first-touch attribution are preserved.
    existingUser = await prisma.user.upsert({
      where: { email: buyerEmail },
      update: { email: buyerEmail },
      create: {
        email: buyerEmail,
        name: payment.buyerName,
        role: "STUDENT",
        attribution: payment.attribution,
      },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        attribution: true,
        stripeCustomerId: true,
      },
    });
  }

  if (!existingUser) {
    throw new Error("Could not reconcile Checkout buyer");
  }

  const stripeCustomerId =
    typeof checkoutSession.customer === "string"
      ? checkoutSession.customer
      : checkoutSession.customer?.id;
  const paymentIntentId =
    typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : checkoutSession.payment_intent?.id;

  if (stripeCustomerId && !existingUser.stripeCustomerId) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, stripeCustomerId: null },
      data: { stripeCustomerId },
    });
  }
  if (payment.attribution && !existingUser.attribution) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, attribution: null },
      data: { attribution: payment.attribution },
    });
  }
  if (payment.buyerName && !existingUser.name) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, name: null },
      data: { name: payment.buyerName },
    });
  }

  const memberCount = await prisma.groupMember.count({
    where: { groupId: payment.groupId },
  });
  if (memberCount >= payment.group.seats) {
    // The buyer has paid, so honor the seat. Active pending reservations make
    // this rare; logging lets operations reconcile any genuine oversell.
    console.warn(`Paid tier ${payment.groupId} is at or above capacity; honoring purchase`);
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        userId: existingUser.id,
        buyerEmail: existingUser.email,
        status: "paid",
        stripePaymentIntentId: paymentIntentId,
      },
    }),
    prisma.groupMember.upsert({
      where: {
        groupId_userId: { groupId: payment.groupId, userId: existingUser.id },
      },
      create: { groupId: payment.groupId, userId: existingUser.id },
      update: { userId: existingUser.id },
    }),
    prisma.enrollment.upsert({
      where: {
        userId_cohortId: { userId: existingUser.id, cohortId: payment.cohortId },
      },
      create: {
        userId: existingUser.id,
        cohortId: payment.cohortId,
        source: "stripe",
        attribution: payment.attribution,
        segment: payment.segment,
      },
      update: {
        source: "stripe",
        status: "active",
        attribution: payment.attribution,
        segment: payment.segment,
      },
    }),
  ]);

  // CRM is intentionally fire-and-forget: its failure must not turn a successful
  // webhook into a Stripe retry, where replaying a grant is the more harmful outcome.
  void markLeadWonForPurchase({
    buyerEmail: existingUser.email,
    userId: payment.userId ? existingUser.id : undefined,
    kind: "COHORT",
    refId: payment.id,
  }).catch((error: unknown) => {
    logger.error(
      {
        err: error instanceof Error ? error.message : String(error),
        paymentId: payment.id,
        checkoutSessionId: checkoutSession.id,
      },
      "Lead auto-WON failed after cohort grant (non-fatal)"
    );
  });

  // Pre-start reminder sequence (welcome + T-7d/T-1d/T-2h). Best-effort by
  // design — enrollInCohortReminderCampaigns never throws, and the drip tick's
  // cohort sweep re-covers anyone this misses. Must never break fulfillment.
  await enrollInCohortReminderCampaigns(
    existingUser.email,
    existingUser.name,
    payment.cohortId
  );

  // Passwordless guest-created accounts receive a one-time setup link. Marking
  // the payment only after mail succeeds makes webhook retries recover mail
  // delivery without duplicating the enrollment.
  if (!existingUser.password && !payment.accountSetupSentAt) {
    const setupToken = await generateAccountSetupToken(existingUser.email);
    await sendAccountSetupEmail(
      existingUser.email,
      setupToken.token,
      payment.cohort.title
    );
    await prisma.payment.update({
      where: { id: payment.id },
      data: { accountSetupSentAt: new Date() },
    });
  }
}

async function grantProgramAccess(checkoutSession: Stripe.Checkout.Session) {
  // Only sessions previously recorded by our checkout endpoint are trusted for
  // fulfillment. Stripe's signature proves the event, while this row proves the
  // session was created for a real hub program at a server-calculated price.
  const stripeSessionId = requireCheckoutSessionId(checkoutSession);
  const payment = await prisma.payment.findUnique({
    where: { stripeSessionId },
    include: { program: { select: { id: true, name: true } } },
  });

  if (!payment) {
    throw new Error("No fulfillable payment record for Checkout Session");
  }
  if (!payment.programId || !payment.program) {
    throw new Error(
      `Payment ${payment.id} is missing program fulfillment context`
    );
  }
  if (payment.status === "refunded") return;

  const buyerEmail = normalizeEmail(
    payment.userId
      ? payment.buyerEmail
      : checkoutSession.customer_details?.email ??
          checkoutSession.customer_email ??
          payment.buyerEmail
  );

  let existingUser = payment.userId
    ? await prisma.user.findUnique({
        where: { id: payment.userId },
        select: {
          id: true,
          email: true,
          name: true,
          password: true,
          attribution: true,
          stripeCustomerId: true,
        },
      })
    : buyerEmail
      ? await prisma.user.findUnique({
          where: { email: buyerEmail },
          select: {
            id: true,
            email: true,
            name: true,
            password: true,
            attribution: true,
            stripeCustomerId: true,
          },
        })
      : null;

  if (!existingUser && !buyerEmail) {
    throw new Error("Paid Checkout Session has no valid buyer email");
  }

  if (!existingUser && buyerEmail) {
    // Upsert closes the race if two paid sessions for the same new email are
    // delivered concurrently. The update is intentionally minimal so existing
    // profile data and first-touch attribution are preserved.
    existingUser = await prisma.user.upsert({
      where: { email: buyerEmail },
      update: { email: buyerEmail },
      create: {
        email: buyerEmail,
        name: payment.buyerName,
        role: "STUDENT",
        attribution: payment.attribution,
      },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        attribution: true,
        stripeCustomerId: true,
      },
    });
  }

  if (!existingUser) {
    throw new Error("Could not reconcile Checkout buyer");
  }

  const stripeCustomerId =
    typeof checkoutSession.customer === "string"
      ? checkoutSession.customer
      : checkoutSession.customer?.id;
  const paymentIntentId =
    typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : checkoutSession.payment_intent?.id;

  if (stripeCustomerId && !existingUser.stripeCustomerId) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, stripeCustomerId: null },
      data: { stripeCustomerId },
    });
  }
  if (payment.attribution && !existingUser.attribution) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, attribution: null },
      data: { attribution: payment.attribution },
    });
  }
  if (payment.buyerName && !existingUser.name) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, name: null },
      data: { name: payment.buyerName },
    });
  }

  const programId = payment.programId;
  const userId = existingUser.id;
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        userId,
        buyerEmail: existingUser.email,
        status: "paid",
        stripePaymentIntentId: paymentIntentId,
      },
    }),
    // This is THE entitlement checkProgramAccess honors; empty update makes retries a no-op, not a re-stamp.
    prisma.programAccess.upsert({
      where: { programId_userId: { programId, userId } },
      create: { programId, userId },
      update: {},
    }),
    // This is the non-entitlement "my courses" listing row.
    prisma.programEnrollment.upsert({
      where: { userId_programId: { userId, programId } },
      create: { userId, programId },
      update: {},
    }),
  ]);

  try {
    await onProgramPurchased({
      paymentId: payment.id,
      programId,
      programName: payment.program.name,
      userId,
      email: existingUser.email,
      name: existingUser.name,
    });
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : String(error),
        paymentId: payment.id,
        programId,
        userId,
      },
      "Program purchase lifecycle escaped its non-fatal boundary"
    );
  }

  // Passwordless guest-created accounts receive a one-time setup link. Marking
  // the payment only after mail succeeds makes webhook retries recover mail
  // delivery without duplicating the enrollment.
  if (!existingUser.password && !payment.accountSetupSentAt) {
    const setupToken = await generateAccountSetupToken(existingUser.email);
    await sendAccountSetupEmail(
      existingUser.email,
      setupToken.token,
      payment.program.name
    );
    await prisma.payment.update({
      where: { id: payment.id },
      data: { accountSetupSentAt: new Date() },
    });
  }
}

// The current period end moved from the Subscription top level onto its items
// in recent Stripe API versions. Read whichever the account's version exposes.
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const s = sub as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const unix = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return unix ? new Date(unix * 1000) : null;
}

// Maps a Stripe subscription status onto our membership status vocabulary.
function mapSubscriptionStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "canceled";
  }
}

// Activates the academy membership after a subscription Checkout
// completes. Only sessions previously recorded by our checkout endpoint are
// trusted; find-or-create the buyer and mark the membership active.
async function grantMembership(checkoutSession: Stripe.Checkout.Session) {
  const membership = await prisma.membership.findUnique({
    where: { stripeSessionId: checkoutSession.id },
  });
  if (!membership) {
    throw new Error("No membership record for subscription Checkout Session");
  }
  if (membership.status === "canceled") return;

  const buyerEmail = normalizeEmail(
    membership.userId
      ? membership.buyerEmail
      : checkoutSession.customer_details?.email ??
          checkoutSession.customer_email ??
          membership.buyerEmail
  );

  let existingUser = membership.userId
    ? await prisma.user.findUnique({
        where: { id: membership.userId },
        select: { id: true, email: true, name: true, password: true, attribution: true, stripeCustomerId: true },
      })
    : buyerEmail
      ? await prisma.user.findUnique({
          where: { email: buyerEmail },
          select: { id: true, email: true, name: true, password: true, attribution: true, stripeCustomerId: true },
        })
      : null;

  if (!existingUser && !buyerEmail) {
    throw new Error("Subscription Checkout Session has no valid buyer email");
  }

  if (!existingUser && buyerEmail) {
    existingUser = await prisma.user.upsert({
      where: { email: buyerEmail },
      update: { email: buyerEmail },
      create: {
        email: buyerEmail,
        name: membership.buyerName,
        role: "STUDENT",
        attribution: membership.attribution,
      },
      select: { id: true, email: true, name: true, password: true, attribution: true, stripeCustomerId: true },
    });
  }

  if (!existingUser) {
    throw new Error("Could not reconcile membership buyer");
  }

  const stripeCustomerId =
    typeof checkoutSession.customer === "string"
      ? checkoutSession.customer
      : checkoutSession.customer?.id;
  const subscriptionId =
    typeof checkoutSession.subscription === "string"
      ? checkoutSession.subscription
      : checkoutSession.subscription?.id;

  if (stripeCustomerId && !existingUser.stripeCustomerId) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, stripeCustomerId: null },
      data: { stripeCustomerId },
    });
  }
  if (membership.attribution && !existingUser.attribution) {
    await prisma.user.updateMany({
      where: { id: existingUser.id, attribution: null },
      data: { attribution: membership.attribution },
    });
  }

  // Pull authoritative status/period end from the subscription itself.
  let status = "active";
  let currentPeriodEnd: Date | null = null;
  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      status = mapSubscriptionStatus(sub.status);
      currentPeriodEnd = subscriptionPeriodEnd(sub);
    } catch {
      // Keep the optimistic "active"; a later subscription.updated event will reconcile.
    }
  }

  await prisma.membership.update({
    where: { id: membership.id },
    data: {
      userId: existingUser.id,
      buyerEmail: existingUser.email,
      stripeCustomerId: stripeCustomerId ?? membership.stripeCustomerId,
      stripeSubscriptionId: subscriptionId ?? membership.stripeSubscriptionId,
      status,
      currentPeriodEnd,
    },
  });

  if (status === "active") {
    // CRM is intentionally fire-and-forget: its failure must not turn a successful
    // webhook into a Stripe retry, where replaying a grant is the more harmful outcome.
    void markLeadWonForPurchase({
      buyerEmail: existingUser.email,
      userId: membership.userId ? existingUser.id : undefined,
      kind: "MEMBERSHIP",
      refId: membership.id,
    }).catch((error: unknown) => {
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          membershipId: membership.id,
          checkoutSessionId: checkoutSession.id,
        },
        "Lead auto-WON failed after membership grant (non-fatal)"
      );
    });
  }

  // Passwordless guest-created accounts receive a one-time setup link.
  if (!existingUser.password && !membership.accountSetupSentAt) {
    const setupToken = await generateAccountSetupToken(existingUser.email);
    await sendAccountSetupEmail(
      existingUser.email,
      setupToken.token,
      brand.products.membership
    );
    await prisma.membership.update({
      where: { id: membership.id },
      data: { accountSetupSentAt: new Date() },
    });
  }

  // Welcome email + CRM/drip side effects (each idempotent internally).
  if (status === "active") {
    await onMembershipActivated(membership.id);
  }
}

// Resolves which membership tier a subscription is on, preferring the price id
// (matched against the managed per-tier price-id secrets) and falling back to
// the subscription's `tier` metadata (set by checkout and change-tier).
async function resolveSubscriptionTier(
  subscription: Stripe.Subscription
): Promise<{ tier: string; amount: number | null } | null> {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id;
  const amount = typeof item?.price?.unit_amount === "number" ? item.price.unit_amount : null;

  if (priceId) {
    for (const tier of Object.keys(MEMBERSHIP_TIER_CONFIG) as Array<
      keyof typeof MEMBERSHIP_TIER_CONFIG
    >) {
      const configured = await getSecret(MEMBERSHIP_TIER_CONFIG[tier].priceIdEnvVar);
      if (configured && configured === priceId) {
        return { tier, amount: amount ?? MEMBERSHIP_TIER_CONFIG[tier].amountCents };
      }
    }
  }

  const metadataTier = subscription.metadata?.tier;
  if (metadataTier && metadataTier in MEMBERSHIP_TIER_CONFIG) {
    return { tier: metadataTier, amount };
  }

  return null;
}

// Reconciles renewals, cancellations, and payment failures for an existing
// membership. Idempotent: keyed on the Stripe subscription id.
async function syncMembershipStatus(subscription: Stripe.Subscription) {
  const currentPeriodEnd = subscriptionPeriodEnd(subscription);
  // Tier can change out from under us (change-tier route, or a plan switch in
  // the billing portal) — the price id on the subscription is authoritative.
  const resolved = await resolveSubscriptionTier(subscription);
  await prisma.membership.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: {
      status: mapSubscriptionStatus(subscription.status),
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      ...(resolved ? { tier: resolved.tier } : {}),
      ...(resolved?.amount != null ? { amount: resolved.amount } : {}),
    },
  });
}
