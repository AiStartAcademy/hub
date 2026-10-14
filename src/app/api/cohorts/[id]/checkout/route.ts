import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  ATTRIBUTION_COOKIE,
  REF_COOKIE,
  SEGMENT_COOKIE,
  parseAttributionCookie,
  parseSegmentCookie,
} from "@/lib/attribution";
import { validateCode } from "@/lib/coupons";
import { conversionIdsFromRequest } from "@/lib/serverConversions";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { groupSeatInclude, seatsTaken } from "@/lib/seats";
import { logger } from "@/lib/logger";
import { buildCheckoutSessionParams } from "@/lib/payments/checkoutSessionParams";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Enrollment closes when the cohort starts — a running cohort is not purchasable
// even via a direct link to the pay page.
const PURCHASABLE_STATUSES = ["ENROLLMENT"];
const CHECKOUT_TTL_MINUTES = 30;

type SessionUser = { id?: string; email?: string | null; name?: string | null };

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase().slice(0, 320);
  return EMAIL_PATTERN.test(email) ? email : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 100);
  return name || null;
}

// POST /api/cohorts/[id]/checkout — starts a Stripe Checkout Session for a
// paid tier. Guests provide name/email; no account or seat is created here.
// The verified webhook remains the only path that grants access.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!stripeConfigured) {
    return NextResponse.json(
      { error: "Payments are not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    const session = await auth();
    const sessionUser = session?.user as SessionUser | undefined;
    let userId = sessionUser?.id;
    let buyerEmail = normalizeEmail(sessionUser?.email ?? body.email);
    let buyerName = normalizeName(sessionUser?.name ?? body.name);

    if (!sessionUser && (!buyerEmail || !buyerName)) {
      return NextResponse.json(
        { error: "Name and a valid email are required" },
        { status: 400 }
      );
    }

    const { id: cohortParam } = await params;
    const cohort = await prisma.cohort.findFirst({
      where: {
        OR: [{ id: cohortParam }, { slug: cohortParam }],
        status: { in: PURCHASABLE_STATUSES },
      },
      select: { id: true, slug: true, title: true },
    });
    if (!cohort) {
      return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    }

    let account = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true, stripeCustomerId: true },
        })
      : buyerEmail
        ? await prisma.user.findUnique({
            where: { email: buyerEmail },
            select: { id: true, email: true, name: true, stripeCustomerId: true },
          })
        : null;

    if (sessionUser && !account) {
      return NextResponse.json({ error: "Account not found" }, { status: 401 });
    }

    if (sessionUser && account) {
      userId = account.id;
      buyerEmail = normalizeEmail(account.email);
      buyerName = normalizeName(account.name) ?? buyerName;
    }

    if (!buyerEmail) {
      return NextResponse.json(
        { error: "A valid account email is required" },
        { status: 400 }
      );
    }

    const now = new Date();
    const group = await prisma.group.findFirst({
      where: { id: groupId, cohortId: cohort.id },
      include: groupSeatInclude(now),
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    if (group.price <= 0) {
      return NextResponse.json(
        { error: "This group is free — use the enroll endpoint" },
        { status: 400 }
      );
    }

    if (account) {
      const existingMember = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: account.id } },
      });
      if (existingMember) {
        return NextResponse.json(
          {
            error: sessionUser
              ? "Already in this group"
              : "This purchase cannot be completed. Please sign in or contact support.",
          },
          { status: 409 }
        );
      }
    }

    // Reuse a still-open Checkout Session so retries/double-clicks do not create
    // duplicate pending reservations or potential duplicate charges.
    const existingPending = await prisma.payment.findFirst({
      where: {
        groupId,
        status: "pending",
        expiresAt: { gt: now },
        ...(userId ? { userId } : { buyerEmail }),
      },
      orderBy: { createdAt: "desc" },
    });
    // Cohort checkout rows always carry a session id (only venue rental
    // placeholders are created without one), but the column is now nullable —
    // narrow before handing it to Stripe.
    if (existingPending?.stripeSessionId) {
      const pendingSession = await stripe.checkout.sessions.retrieve(
        existingPending.stripeSessionId
      );
      if (pendingSession.status === "open" && pendingSession.url) {
        return NextResponse.json({ url: pendingSession.url });
      }
      await prisma.payment.update({
        where: { id: existingPending.id },
        data: { status: "failed" },
      });
    }

    if (seatsTaken(group) >= group.seats) {
      return NextResponse.json({ error: "Group is full" }, { status: 409 });
    }

    // Logged-in customers keep their existing Stripe customer. A guest (or an
    // existing account without a customer) gets a Stripe customer only as part
    // of Checkout, not before payment.
    let customerId = account?.stripeCustomerId ?? undefined;
    if (sessionUser && account && !customerId) {
      const customer = await stripe.customers.create({
        email: buyerEmail,
        name: buyerName ?? undefined,
        metadata: { userId: account.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: account.id },
        data: { stripeCustomerId: customerId },
      });
      account = { ...account, stripeCustomerId: customerId };
    }

    const attribution = parseAttributionCookie(
      req.cookies.get(ATTRIBUTION_COOKIE)?.value
    );
    const segment = parseSegmentCookie(req.cookies.get(SEGMENT_COOKIE)?.value);
    const amount = Math.round(group.price * 100);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const publicId = cohort.slug || cohort.id;
    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60_000);
    const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
    // Ad/analytics identifiers live in browser cookies, but the Stripe webhook that
    // confirms the payment is a server-to-server call with no cookies at all. Carry
    // them through Stripe metadata so the webhook can report a *matched* Purchase to
    // GA4 and Meta instead of an anonymous one. Values are opaque ids, not PII.
    const adIds = conversionIdsFromRequest(req);

    const metadata: Stripe.MetadataParam = {
      checkoutKind: sessionUser ? "account" : "guest",
      cohortId: cohort.id,
      groupId,
      buyerEmail,
      ...(buyerName ? { buyerName } : {}),
      ...(userId ? { userId } : {}),
      ...adIds,
    };

    // A coupon code may arrive explicitly (?code= from a /join link or drip
    // email) or via the aisa_ref cookie set by /join/CODE. When valid it is
    // pre-applied; otherwise buyers may type a code in Checkout. Stripe
    // forbids combining `discounts` with `allow_promotion_codes`, so the two
    // modes are mutually exclusive.
    const requestedCode =
      (typeof body.code === "string" ? body.code : null) ??
      req.cookies.get(REF_COOKIE)?.value ??
      null;
    const coupon = requestedCode
      ? await validateCode(requestedCode, {
          appliesTo: "cohort",
          cohortId: cohort.id,
          buyerEmail,
        })
      : null;

    const checkout = await stripe.checkout.sessions.create(
      buildCheckoutSessionParams({
      customerId,
      buyerEmail,
      userId,
      metadata,
      expiresAtUnix,
      coupon,
      lineItems: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: { name: `${cohort.title} — ${group.name}` },
          },
        },
      ],
      successUrl: `${appUrl}/cohorts/${publicId}?checkout=success&sid={CHECKOUT_SESSION_ID}&amt=${group.price}${sessionUser ? "" : "&guest=1"}`,
      cancelUrl: `${appUrl}/cohorts/${publicId}?checkout=cancelled`,
    })
    );

    try {
      await prisma.payment.create({
        data: {
          userId: account?.id ?? null,
          cohortId: cohort.id,
          groupId,
          buyerEmail,
          buyerName,
          attribution: attribution ? JSON.stringify(attribution) : null,
          segment,
          stripeSessionId: checkout.id,
          amount,
          currency: "usd",
          status: "pending",
          expiresAt,
          checkoutUrl: checkout.url,
          couponCode: coupon?.code ?? null,
        },
      });
    } catch (error) {
      await stripe.checkout.sessions.expire(checkout.id).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    logger.error(
      {err :  error instanceof Error ? error.message : "Unknown checkout error"},
      "Checkout error:"  
    );
    return NextResponse.json(
      { error: "Failed to start checkout" },
      { status: 500 }
    );
  }
}
