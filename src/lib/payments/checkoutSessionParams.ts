import type Stripe from "stripe";

type CheckoutCoupon = {
  stripePromotionCodeId: string | null;
};

export type BuildCheckoutSessionParamsInput = {
  customerId: string | null | undefined;
  buyerEmail: string;
  userId: string | null | undefined;
  metadata: Stripe.MetadataParam;
  expiresAtUnix: number;
  coupon: CheckoutCoupon | null;
  lineItems: NonNullable<Stripe.Checkout.SessionCreateParams["line_items"]>;
  successUrl: string;
  cancelUrl: string;
};

/** Builds the shared Stripe Checkout request used by cohort and program sales. */
export function buildCheckoutSessionParams(
  input: BuildCheckoutSessionParamsInput
): Stripe.Checkout.SessionCreateParams {
  const promotionCodeId = input.coupon?.stripePromotionCodeId;

  return {
    mode: "payment",
    ...(input.customerId
      ? { customer: input.customerId }
      : {
          customer_email: input.buyerEmail,
          customer_creation: "always" as const,
        }),
    ...(input.userId ? { client_reference_id: input.userId } : {}),
    metadata: input.metadata,
    payment_intent_data: { metadata: input.metadata },
    expires_at: input.expiresAtUnix,
    after_expiration: {
      recovery: {
        enabled: true,
        allow_promotion_codes: !promotionCodeId,
      },
    },
    ...(promotionCodeId
      ? { discounts: [{ promotion_code: promotionCodeId }] }
      : { allow_promotion_codes: true }),
    line_items: input.lineItems,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}
