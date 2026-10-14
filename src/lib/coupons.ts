// src/lib/coupons.ts
//
// Hub-side coupon system, mirrored to Stripe. The hub row is the source of
// truth for applicability (cohort vs membership), ownership (affiliate codes)
// and redemption tracking; Stripe owns the actual price math at checkout via
// a mirrored Coupon + Promotion Code (ids stored on the hub row).
//
// Application modes at checkout — mutually exclusive per Stripe session:
//   • pre-applied: `discounts: [{ promotion_code }]` when a valid code arrives
//     via ?code= or the aisa_ref cookie (QR posters, /join links, drip emails);
//   • typed: `allow_promotion_codes: true` otherwise (manual grants, word of
//     mouth). Stripe forbids combining the two.
//
// Redemptions are written ONLY by the Stripe webhook (the source of truth for
// money), from the completed session's discount totals.

import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import { stripe } from "@/lib/stripe";

export const COUPON_KINDS = ["MANUAL", "CAMPAIGN", "AFFILIATE"] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

export const COUPON_APPLIES_TO = ["all", "cohort", "membership", "program"] as const;
export type CouponAppliesTo = (typeof COUPON_APPLIES_TO)[number];

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,30}$/;

export class CouponInputError extends Error {}

/** Uppercases and validates a human-entered code. Returns null when unusable. */
export function normalizeCouponCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export type CreateCouponInput = {
  code: string;
  kind: CouponKind;
  percentOff?: number | null;
  amountOff?: number | null; // cents
  appliesTo?: CouponAppliesTo;
  cohortId?: string | null;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
  ownerUserId?: string | null;
  commissionPercent?: number | null;
  note?: string | null;
};

function validateCreateInput(input: CreateCouponInput) {
  const code = normalizeCouponCode(input.code);
  if (!code) {
    throw new CouponInputError(
      "Code must be 2-31 characters: letters, numbers, dashes"
    );
  }
  const hasPercent = input.percentOff != null;
  const hasAmount = input.amountOff != null;
  if (hasPercent === hasAmount) {
    throw new CouponInputError(
      "Provide exactly one of percentOff or amountOff"
    );
  }
  if (hasPercent && (!Number.isInteger(input.percentOff) || input.percentOff! < 1 || input.percentOff! > 100)) {
    throw new CouponInputError("percentOff must be an integer 1-100");
  }
  if (hasAmount && (!Number.isInteger(input.amountOff) || input.amountOff! < 1)) {
    throw new CouponInputError("amountOff must be a positive integer (cents)");
  }
  if (input.maxRedemptions != null && (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1)) {
    throw new CouponInputError("maxRedemptions must be a positive integer");
  }
  if (
    input.commissionPercent != null &&
    (!Number.isInteger(input.commissionPercent) ||
      input.commissionPercent < 0 ||
      input.commissionPercent > 100)
  ) {
    throw new CouponInputError("commissionPercent must be an integer 0-100");
  }
  const appliesTo = input.appliesTo ?? "all";
  if (!COUPON_APPLIES_TO.includes(appliesTo)) {
    throw new CouponInputError("appliesTo must be all | cohort | membership | program");
  }
  return { code, appliesTo };
}

/**
 * Creates a hub Coupon and its Stripe mirror (Coupon + Promotion Code).
 * On a Stripe failure after partial creation, cleans up so no orphans remain.
 *
 * `duration` note: one-time cohort payments only ever see the discount once;
 * for subscriptions "once" discounts the first invoice only — the intended
 * behavior for membership recovery/referral offers.
 */
export async function createCoupon(input: CreateCouponInput) {
  const { code, appliesTo } = validateCreateInput(input);

  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) {
    throw new CouponInputError(`Code ${code} already exists`);
  }

  let stripeCoupon: Stripe.Coupon | null = null;
  let promotionCode: Stripe.PromotionCode | null = null;
  try {
    stripeCoupon = await stripe.coupons.create({
      name: code,
      duration: "once",
      ...(input.percentOff != null
        ? { percent_off: input.percentOff }
        : { amount_off: input.amountOff!, currency: "usd" }),
    });
    promotionCode = await stripe.promotionCodes.create({
      // Stripe API 22.x nests the coupon under `promotion` rather than
      // taking a bare `coupon` id.
      promotion: { type: "coupon", coupon: stripeCoupon.id },
      code,
      // Belt-and-suspenders: mirror hub-side limits so a typed code obeys
      // them even if the hub validation is bypassed.
      ...(input.maxRedemptions != null
        ? { max_redemptions: input.maxRedemptions }
        : {}),
      ...(input.expiresAt
        ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) }
        : {}),
    });
  } catch (error) {
    if (stripeCoupon) {
      await stripe.coupons.del(stripeCoupon.id).catch(() => undefined);
    }
    throw error;
  }

  try {
    return await prisma.coupon.create({
      data: {
        code,
        kind: input.kind,
        percentOff: input.percentOff ?? null,
        amountOff: input.amountOff ?? null,
        appliesTo,
        cohortId: appliesTo === "cohort" ? (input.cohortId ?? null) : null,
        maxRedemptions: input.maxRedemptions ?? null,
        expiresAt: input.expiresAt ?? null,
        ownerUserId: input.ownerUserId ?? null,
        commissionPercent: input.commissionPercent ?? null,
        note: input.note ?? null,
        stripeCouponId: stripeCoupon.id,
        stripePromotionCodeId: promotionCode.id,
      },
    });
  } catch (error) {
    // DB write failed after Stripe objects exist — remove them so the code
    // can be recreated cleanly.
    await stripe.promotionCodes
      .update(promotionCode.id, { active: false })
      .catch(() => undefined);
    await stripe.coupons.del(stripeCoupon.id).catch(() => undefined);
    throw error;
  }
}

/** Deactivates the code in both systems. Idempotent. */
export async function deactivateCoupon(id: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new CouponInputError("Coupon not found");
  if (coupon.stripePromotionCodeId) {
    await stripe.promotionCodes
      .update(coupon.stripePromotionCodeId, { active: false })
      .catch(() => undefined);
  }
  return prisma.coupon.update({ where: { id }, data: { active: false } });
}

export type ValidateCodeContext = {
  appliesTo: Exclude<CouponAppliesTo, "all">; // what checkout is this?
  cohortId?: string | null;
  buyerEmail?: string | null; // for affiliate self-referral rejection
  now?: Date;
};

export type ValidCoupon = NonNullable<Awaited<ReturnType<typeof validateCode>>>;

/**
 * Hub-side gate for applying a code at checkout. Returns the coupon row when
 * usable in this context, null otherwise (never throws for a bad code — an
 * invalid code silently falls back to the typed-promo-code path).
 */
export async function validateCode(
  rawCode: unknown,
  context: ValidateCodeContext
) {
  const code = normalizeCouponCode(rawCode);
  if (!code) return null;
  const now = context.now ?? new Date();

  const coupon = await prisma.coupon.findUnique({
    where: { code },
    include: {
      _count: { select: { redemptions: true } },
      owner: { select: { email: true } },
    },
  });
  if (!coupon || !coupon.active || !coupon.stripePromotionCodeId) return null;
  if (coupon.expiresAt && coupon.expiresAt < now) return null;
  if (
    coupon.maxRedemptions != null &&
    coupon._count.redemptions >= coupon.maxRedemptions
  ) {
    return null;
  }
  if (coupon.appliesTo !== "all" && coupon.appliesTo !== context.appliesTo) {
    return null;
  }
  if (
    coupon.appliesTo === "cohort" &&
    coupon.cohortId &&
    coupon.cohortId !== (context.cohortId ?? null)
  ) {
    return null;
  }
  // Fraud guard: an affiliate cannot redeem their own code.
  if (
    coupon.ownerUserId &&
    coupon.owner?.email &&
    context.buyerEmail &&
    coupon.owner.email.trim().toLowerCase() ===
      context.buyerEmail.trim().toLowerCase()
  ) {
    return null;
  }
  return coupon;
}

function sessionPromotionCodeId(
  session: Stripe.Checkout.Session
): string | null {
  for (const discount of session.discounts ?? []) {
    const promo = discount.promotion_code;
    if (typeof promo === "string") return promo;
    if (promo?.id) return promo.id;
  }
  return null;
}

/**
 * Records a completed discounted checkout. Called from the Stripe webhook.
 * Idempotent: the unique paymentId/membershipId absorbs webhook retries.
 * Resolves the hub Coupon by the session's promotion-code id first, falling
 * back to the couponCode stored on the pending row (typed codes created
 * outside the hub resolve by code string too).
 */
export async function recordRedemption(
  session: Stripe.Checkout.Session,
  target: { paymentId: string } | { membershipId: string },
  options: { buyerEmail: string | null; couponCode?: string | null }
) {
  const amountOff = session.total_details?.amount_discount ?? 0;
  if (amountOff <= 0) return null;

  const promoId = sessionPromotionCodeId(session);
  const coupon = promoId
    ? await prisma.coupon.findUnique({
        where: { stripePromotionCodeId: promoId },
      })
    : options.couponCode
      ? await prisma.coupon.findUnique({
          where: { code: options.couponCode.toUpperCase() },
        })
      : null;
  if (!coupon) return null; // discount came from a Stripe-only code — nothing to track

  const amountTotal = session.amount_total ?? 0;
  const commission =
    coupon.ownerUserId && coupon.commissionPercent
      ? Math.round((amountTotal * coupon.commissionPercent) / 100)
      : null;

  const where =
    "paymentId" in target
      ? { paymentId: target.paymentId }
      : { membershipId: target.membershipId };

  return prisma.redemption.upsert({
    where,
    create: {
      couponId: coupon.id,
      ...target,
      buyerEmail: options.buyerEmail ?? "",
      amountOff,
      commission,
      commissionStatus: commission != null ? "pending" : null,
    },
    update: { amountOff, ...(commission != null ? { commission } : {}) },
  });
}
