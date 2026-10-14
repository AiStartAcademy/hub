import { describe, expect, test } from "bun:test";

import { buildPendingVenueRentalPayment } from "@/lib/venueRentalRecord";

describe("buildPendingVenueRentalPayment", () => {
  const base = {
    venueEventId: "ve_1",
    paymentLinkId: "plink_1",
    feeCents: 50_000,
    depositCents: 20_000,
    contactEmail: "Organizer@Example.com ",
    organizerName: "  Jamie Organizer ",
  };

  test("builds a pending placeholder with fee + deposit and normalized contact", () => {
    expect(buildPendingVenueRentalPayment(base)).toEqual({
      venueEventId: "ve_1",
      stripePaymentLinkId: "plink_1",
      buyerEmail: "organizer@example.com",
      buyerName: "Jamie Organizer",
      amount: 70_000,
      currency: "usd",
      status: "pending",
    });
  });

  test("zero deposit charges the fee alone", () => {
    expect(
      buildPendingVenueRentalPayment({ ...base, depositCents: 0 }).amount
    ).toBe(50_000);
  });

  test("invalid contact email becomes null, not a junk identity", () => {
    expect(
      buildPendingVenueRentalPayment({ ...base, contactEmail: "not-an-email" })
        .buyerEmail
    ).toBeNull();
    expect(
      buildPendingVenueRentalPayment({ ...base, contactEmail: null }).buyerEmail
    ).toBeNull();
  });
});
