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
import {
  MEMBERSHIP_TIER_CONFIG,
  type MembershipTier,
} from "@/lib/membershipTiers";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { conversionIdsFromRequest } from "@/lib/serverConversions";
import { getSecret } from "@/lib/secrets";
import { logger } from "@/lib/logger";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mirrors the cohort checkout TTL: after this a pending Membership counts as
// an abandoned checkout for the recovery drip. Stripe's minimum expires_at
// is 30 minutes.
const CHECKOUT_TTL_MINUTES = 30;
type SessionUser = { id?: string; email?: string | null; name?: string | null };
type BodyObject = Record<string, unknown>;

function isBodyObject(value: unknown): value is BodyObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bodyString(body: unknown, key: string): string | undefined {
  if (!isBodyObject(body)) return undefined;
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function parseMembershipTier(body: unknown):
  | { ok: true; tier: MembershipTier }
  | { ok: false; error: string } {
  const tierValue = bodyString(body, "tier");
  if (!tierValue || !tierValue.trim()) {
    return { ok: true, tier: "MENTOR_NETWORK" };
  }

  const tier = tierValue.trim();
  if (tier === "MENTOR_NETWORK" || tier === "ACCELERATOR") {
    return { ok: true, tier };
  }

  return {
    ok: false,
    error: "Invalid membership tier. Expected MENTOR_NETWORK or ACCELERATOR.",
  };
}

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

// POST /api/membership/checkout — starts a Stripe *subscription* Checkout Session
// for the selected monthly membership tier. Guests provide an email (or Stripe
// collects it); no account or membership is activated here. The verified
// webhook remains the only path that grants member access.
export async function POST(req: NextRequest) {
  if (!stripeConfigured) {
    return NextResponse.json(
      { error: "Payments are not configured" },
      { status: 500 }
    );
  }

  try {
    const body: unknown = await req.json().catch((): unknown => ({}));
    const parsedTier = parseMembershipTier(body);
    if (!parsedTier.ok) {
      return NextResponse.json({ error: parsedTier.error }, { status: 400 });
    }

    const tier = parsedTier.tier;
    const tierConfig = MEMBERSHIP_TIER_CONFIG[tier];
    const amountDollars = String(tierConfig.amountCents / 100);

    const session = await auth();
    const sessionUser = session?.user as SessionUser | undefined;
    let userId = sessionUser?.id;
    let buyerEmail = normalizeEmail(sessionUser?.email ?? bodyString(body, "email"));
    let buyerName = normalizeName(sessionUser?.name ?? bodyString(body, "name"));

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

    // Block obvious duplicates: an already-active membership for this account.
    if (account) {
      const active = await prisma.membership.findFirst({
        where: { userId: account.id, status: "active", tier },
        select: { id: true },
      });
      if (active) {
        return NextResponse.json(
          { error: `You already have an active ${tierConfig.label} membership.` },
          { status: 409 }
        );
      }
    }

    // Reuse a still-open subscription Checkout Session on retries/double-clicks.
    const existingPending = await prisma.membership.findFirst({
      where: {
        status: "pending",
        tier,
        ...(userId ? { userId } : buyerEmail ? { buyerEmail } : { id: "" }),
      },
      orderBy: { createdAt: "desc" },
    });
    if (existingPending) {
      try {
        const pendingSession = await stripe.checkout.sessions.retrieve(
          existingPending.stripeSessionId
        );
        if (pendingSession.status === "open" && pendingSession.url) {
          return NextResponse.json({ url: pendingSession.url });
        }
      } catch (error) {
        console.warn("Failed to retrieve pending membership checkout session", {
          membershipId: existingPending.id,
          stripeSessionId: existingPending.stripeSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await prisma.membership.update({
        where: { id: existingPending.id },
        data: { status: "canceled" },
      });
    }

    let customerId = account?.stripeCustomerId ?? undefined;
    if (sessionUser && account && !customerId) {
      const customer = await stripe.customers.create({
        email: buyerEmail ?? undefined,
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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    // Price ID is admin-manageable via Settings → Integrations (DB Secret → env fallback).
    const priceId = await getSecret(tierConfig.priceIdEnvVar);

    // Ad/analytics identifiers ride Stripe metadata to the webhook, same as the
    // cohort checkout — without them the membership Purchase reaches Meta with
    // only a hashed email to match on.
    const adIds = conversionIdsFromRequest(req);

    const metadata: Stripe.MetadataParam = {
      checkoutKind: "membership",
      tier,
      ...(buyerEmail ? { buyerEmail } : {}),
      ...(buyerName ? { buyerName } : {}),
      ...(userId ? { userId } : {}),
      ...adIds,
    };

    // Coupon: explicit ?code=/body code or the aisa_ref cookie from /join/CODE.
    // Pre-applied when valid; otherwise buyers may type a code (the two are
    // mutually exclusive per Stripe session).
    const requestedCode =
      bodyString(body, "code") ?? req.cookies.get(REF_COOKIE)?.value ?? null;
    const coupon = requestedCode
      ? await validateCode(requestedCode, {
          appliesTo: "membership",
          buyerEmail,
        })
      : null;

    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60_000);

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customerId
        ? { customer: customerId }
        : buyerEmail
          ? { customer_email: buyerEmail }
          : {}),
      ...(userId ? { client_reference_id: userId } : {}),
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      ...(coupon?.stripePromotionCodeId
        ? { discounts: [{ promotion_code: coupon.stripePromotionCodeId }] }
        : { allow_promotion_codes: true }),
      metadata,
      subscription_data: { metadata },
      line_items: [
        priceId
          ? { quantity: 1, price: priceId }
          : {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: tierConfig.amountCents,
                recurring: { interval: "month" },
                product_data: { name: tierConfig.productName },
              },
            },
      ],
      success_url: `${appUrl}/cohorts?membership=success&sid={CHECKOUT_SESSION_ID}&amt=${amountDollars}${sessionUser ? "" : "&guest=1"}`,
      cancel_url: `${appUrl}/cohorts?membership=cancelled`,
    });

    try {
      await prisma.membership.create({
        data: {
          userId: account?.id ?? null,
          buyerEmail,
          buyerName,
          attribution: attribution ? JSON.stringify(attribution) : null,
          segment,
          stripeSessionId: checkout.id,
          stripeCustomerId: customerId ?? null,
          amount: tierConfig.amountCents,
          currency: "usd",
          tier,
          status: "pending",
          expiresAt,
          checkoutUrl: checkout.url,
          couponCode: coupon?.code ?? null,
        },
      });
    } catch (error) {
      await stripe.checkout.sessions.expire(checkout.id).catch((expireError) => {
        logger.error( { err: {
          stripeSessionId: checkout.id,
          error: expireError instanceof Error ? expireError.message : String(expireError),
        }}, "Failed to expire membership checkout session after DB write error");
      });
      throw error;
    }

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : "Unknown membership checkout error"},
      "Membership checkout error:"
      
    );
    return NextResponse.json(
      { error: "Failed to start checkout" },
      { status: 500 }
    );
  }
}
