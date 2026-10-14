import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";

import { buildVenueRentalPaymentLinkParams } from "@/lib/venueRentalPayment";

describe("venue rental payment link params", () => {
  it("SC-8: configures a redirect when a return URL is present", () => {
    const returnUrl = `${brand.urls.hub}/agreements/tok?paid=1`;
    const params = buildVenueRentalPaymentLinkParams({
      eventId: "event-1",
      feePriceId: "price_fee",
      depositPriceId: null,
      returnUrl,
    });

    expect(params.after_completion).toEqual({
      type: "redirect",
      redirect: {
        url: returnUrl,
      },
    });
    expect(params.after_completion).not.toHaveProperty("hosted_confirmation");
  });

  it("SC-9: preserves the hosted confirmation when no return URL is present", () => {
    const params = buildVenueRentalPaymentLinkParams({
      eventId: "event-1",
      feePriceId: "price_fee",
      depositPriceId: null,
      returnUrl: null,
    });

    expect(params.after_completion).toEqual({
      type: "hosted_confirmation",
      hosted_confirmation: {
        custom_message: "Thank you — your venue rental is confirmed.",
      },
    });
  });

  it("SC-10: preserves metadata and adds the deposit as a second line item", () => {
    const params = buildVenueRentalPaymentLinkParams({
      eventId: "event-1",
      feePriceId: "price_fee",
      depositPriceId: "price_deposit",
      returnUrl: null,
    });

    expect(params.metadata).toEqual({
      kind: "venue_rental",
      venueEventId: "event-1",
    });
    expect(params.payment_intent_data?.metadata).toEqual({
      kind: "venue_rental",
      venueEventId: "event-1",
    });
    expect(params.line_items).toEqual([
      { price: "price_fee", quantity: 1 },
      { price: "price_deposit", quantity: 1 },
    ]);
  });
});
