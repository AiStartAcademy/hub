import { describe, expect, it } from "bun:test";
import { brand } from "@/config/brand";

import {
  buildAgreementReturnUrl,
  formatRentalAmountSummary,
  resolvePostSignPaymentUrl,
  withPrefilledEmail,
} from "@/lib/venueAgreementPayment";

describe("venue agreement payment", () => {
  it("SC-1: resolves a trimmed pending paid-rental payment URL", () => {
    expect(
      resolvePostSignPaymentUrl({
        dealType: "PAID_RENTAL",
        rentalPaymentStatus: "pending",
        rentalPaymentUrl: "  https://buy.stripe.com/test_link  ",
      }),
    ).toBe("https://buy.stripe.com/test_link");
  });

  it("SC-2: returns null when the rental is paid", () => {
    expect(
      resolvePostSignPaymentUrl({
        dealType: "PAID_RENTAL",
        rentalPaymentStatus: "paid",
        rentalPaymentUrl: "https://buy.stripe.com/test_link",
      }),
    ).toBeNull();
  });

  it("SC-3: returns null for every non-paid-rental deal type", () => {
    for (const dealType of ["BARTER", "FREE_PROMO", "REVENUE_SHARE", "INTERNAL"]) {
      expect(
        resolvePostSignPaymentUrl({
          dealType,
          rentalPaymentStatus: "pending",
          rentalPaymentUrl: "https://buy.stripe.com/test_link",
        }),
      ).toBeNull();
    }
  });

  it("SC-4: returns null for null, empty, and blank payment URLs", () => {
    for (const rentalPaymentUrl of [null, "", "   "]) {
      expect(
        resolvePostSignPaymentUrl({
          dealType: "PAID_RENTAL",
          rentalPaymentStatus: "pending",
          rentalPaymentUrl,
        }),
      ).toBeNull();
    }
  });

  it("SC-5: pre-fills a valid email while preserving queries and no-ops on bad input", () => {
    expect(
      withPrefilledEmail("https://buy.stripe.com/test_link", "organizer@example.com"),
    ).toBe("https://buy.stripe.com/test_link?prefilled_email=organizer%40example.com");
    expect(
      withPrefilledEmail(
        "https://buy.stripe.com/test_link?locale=en",
        "organizer+venue@example.com",
      ),
    ).toBe(
      "https://buy.stripe.com/test_link?locale=en&prefilled_email=organizer%2Bvenue%40example.com",
    );
    expect(withPrefilledEmail("not a url", "organizer@example.com")).toBe("not a url");
    expect(withPrefilledEmail("https://buy.stripe.com/test_link", "not-an-email")).toBe(
      "https://buy.stripe.com/test_link",
    );
    expect(withPrefilledEmail("https://buy.stripe.com/test_link", null)).toBe(
      "https://buy.stripe.com/test_link",
    );
  });

  it("SC-6: formats fee and refundable deposit amounts and rejects a null fee", () => {
    expect(formatRentalAmountSummary(40_000, null)).toBe("$400.00");
    expect(formatRentalAmountSummary(40_000, 0)).toBe("$400.00");
    expect(formatRentalAmountSummary(40_000, 25_000)).toBe(
      "$400.00 + $250.00 refundable deposit",
    );
    expect(formatRentalAmountSummary(null, 25_000)).toBeNull();
  });

  it("SC-7: builds the production agreement payment return URL", () => {
    expect(buildAgreementReturnUrl("tok")).toBe(
      `${brand.urls.hub}/agreements/tok?paid=1`,
    );
  });
});
