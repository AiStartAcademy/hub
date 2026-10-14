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
import { checkProgramAccess } from "@/lib/programAccess";
import { conversionIdsFromRequest } from "@/lib/serverConversions";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { buildCheckoutSessionParams } from "@/lib/payments/checkoutSessionParams";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHECKOUT_TTL_MINUTES = 30;

type SessionUser = { id?: string; email?: string | null; name?: string | null };
type CheckoutBody = { email?: unknown; name?: unknown; code?: unknown };

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

// POST /api/programs/[id]/checkout — starts a Stripe Checkout Session for a
// self-paced course. Guests provide name/email; no account or access grant is
// created here. The verified webhook remains the only path that grants access.
export async function POST(
  req: NextRequest,
  // `id` matches the sibling program routes and carries the program id.
  { params }: { params: Promise<{ id: string }> }
) {
  if (!stripeConfigured) {
    return NextResponse.json(
      { error: "Payments are not configured" },
      { status: 500 }
    );
  }

  try {
    const body = (await req.json()) as CheckoutBody;
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

    const { id: programId } = await params;
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        priceCents: true,
        status: true,
        locked: true,
      },
    });
    if (
      !program ||
      program.priceCents == null ||
      program.priceCents <= 0 ||
      program.status !== "open" ||
      program.locked
    ) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    const priceCents = program.priceCents;

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

    // Guests have no authenticated identity to check here; the webhook-side
    // account upsert reconciles a completed purchase by normalized email.
    if (sessionUser && account) {
      const access = await checkProgramAccess(program.id, account.id);
      // Outstanding consent means base access was already resolved; allowing
      // checkout here would sell a second copy to someone who already owns it.
      if (access.hasAccess || access.needsConsent) {
        return NextResponse.json(
          { error: "You already have access to this course" },
          { status: 409 }
        );
      }
    }

    const now = new Date();

    // Reuse a still-open Checkout Session so retries/double-clicks do not create
    // duplicate pending purchases or potential duplicate charges.
    const existingPending = await prisma.payment.findFirst({
      where: {
        programId: program.id,
        status: "pending",
        expiresAt: { gt: now },
        ...(userId ? { userId } : { buyerEmail }),
      },
      orderBy: { createdAt: "desc" },
    });
    // Program checkout rows always carry a session id (only venue rental
    // placeholders are created without one), but the column is nullable —
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
    const amountDollars = priceCents / 100;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60_000);
    const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
    // Ad/analytics identifiers live in browser cookies, but the Stripe webhook that
    // confirms the payment is a server-to-server call with no cookies at all. Carry
    // them through Stripe metadata so the webhook can report a *matched* Purchase to
    // GA4 and Meta instead of an anonymous one. Values are opaque ids, not PII.
    const adIds = conversionIdsFromRequest(req);

    const metadata: Stripe.MetadataParam = {
      checkoutKind: sessionUser ? "account" : "guest",
      programId: program.id,
      buyerEmail,
      ...(buyerName ? { buyerName } : {}),
      ...(userId ? { userId } : {}),
      ...adIds,
    };

    // A coupon code may arrive explicitly (?code= from a /join link or drip
    // email, forwarded by the client in the request body) or via the aisa_ref
    // cookie set by /join/CODE. When valid it is pre-applied; otherwise buyers
    // may type a code in Checkout. Stripe forbids combining `discounts` with
    // `allow_promotion_codes`, so the two modes are mutually exclusive.
    const requestedCode =
      (typeof body.code === "string" ? body.code : null) ??
      req.cookies.get(REF_COOKIE)?.value ??
      null;
    const coupon = requestedCode
      ? await validateCode(requestedCode, {
          appliesTo: "program",
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
            unit_amount: priceCents,
            product_data: { name: program.name },
          },
        },
      ],
      successUrl: `${appUrl}/self-paced?checkout=success&kind=course&sid={CHECKOUT_SESSION_ID}&amt=${amountDollars}${sessionUser ? "" : "&guest=1"}`,
      cancelUrl: `${appUrl}/self-paced?checkout=cancelled&kind=course`,
    })
    );

    try {
      await prisma.payment.create({
        data: {
          userId: account?.id ?? null,
          programId: program.id,
          buyerEmail,
          buyerName,
          attribution: attribution ? JSON.stringify(attribution) : null,
          segment,
          stripeSessionId: checkout.id,
          amount: priceCents,
          currency: "usd",
          status: "pending",
          expiresAt,
          checkoutUrl: checkout.url,
          couponCode: coupon?.code ?? null,
        },
      });
    } catch (error) {
      // The Stripe session cannot remain payable without its pending DB row;
      // expiry is compensating cleanup, while the original write error is rethrown.
      await stripe.checkout.sessions.expire(checkout.id).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    logger.error(
      {
        err:
          error instanceof Error ? error.message : "Unknown program checkout error",
      },
      "Program checkout error:"
    );
    return NextResponse.json(
      { error: "Failed to start checkout" },
      { status: 500 }
    );
  }
}
