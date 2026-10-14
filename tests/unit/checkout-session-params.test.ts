import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";

describe("buildCheckoutSessionParams", () => {
  it("SC-H.1: omits consent collection and keeps coupon options mutually exclusive", async () => {
    const { buildCheckoutSessionParams } = await import(
      "@/lib/payments/checkoutSessionParams"
    );
    const common = {
      customerId: null,
      buyerEmail: "buyer@example.com",
      userId: null,
      metadata: { checkoutKind: "guest", buyerEmail: "buyer@example.com" },
      expiresAtUnix: 1_800_000_000,
      lineItems: [
        {
          quantity: 1,
          price_data: {
            currency: "usd" as const,
            unit_amount: 25_000,
            product_data: { name: brand.name },
          },
        },
      ],
      successUrl: "https://hub.test/success",
      cancelUrl: "https://hub.test/cancel",
    };

    for (const coupon of [null, { stripePromotionCodeId: "promo_123" }]) {
      const params = buildCheckoutSessionParams({ ...common, coupon });

      expect("consent_collection" in params).toBe(false);
      expect("allow_promotion_codes" in params).toBe(!coupon);
      expect("discounts" in params).toBe(Boolean(coupon));
      expect(params.after_expiration?.recovery?.allow_promotion_codes).toBe(!coupon);
    }
  });
});
