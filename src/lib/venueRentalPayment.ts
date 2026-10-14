import Stripe from "stripe";

export const MAX_VENUE_RENTAL_AMOUNT_CENTS = 100_000_00;

export type VenueRentalPaymentRecord = {
  rentalFeeCents: number | null;
  rentalDepositCents: number | null;
  rentalPaymentLinkId: string | null;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
};

export type StripeVenueRentalPaymentLink = {
  linkId: string;
  url: string;
};

type IssuableVenueRentalPaymentState = {
  dealType: string;
  rentalPaymentLinkId: string | null;
  rentalPaymentStatus: string | null;
};

type ClearableVenueRentalPaymentState = {
  rentalPaymentLinkId: string | null;
  rentalPaymentStatus: string | null;
};

export class VenueRentalPaymentInputError extends Error {}

export class VenueRentalPaymentStateError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type VenueRentalPaymentLinkParamsInput = {
  eventId: string;
  feePriceId: string;
  depositPriceId: string | null;
  returnUrl: string | null;
};

export function buildVenueRentalPaymentLinkParams({
  eventId,
  feePriceId,
  depositPriceId,
  returnUrl,
}: VenueRentalPaymentLinkParamsInput): Stripe.PaymentLinkCreateParams {
  const lineItems: Stripe.PaymentLinkCreateParams.LineItem[] = [
    {
      price: feePriceId,
      quantity: 1,
    },
  ];

  if (depositPriceId) {
    lineItems.push({
      price: depositPriceId,
      quantity: 1,
    });
  }

  return {
    line_items: lineItems,
    metadata: {
      kind: "venue_rental",
      venueEventId: eventId,
    },
    payment_intent_data: {
      metadata: {
        kind: "venue_rental",
        venueEventId: eventId,
      },
    },
    after_completion: returnUrl
      ? {
          type: "redirect",
          redirect: {
            url: returnUrl,
          },
        }
      : {
          type: "hosted_confirmation",
          hosted_confirmation: {
            custom_message: "Thank you — your venue rental is confirmed.",
          },
        },
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Stripe returned an invalid ${field}.`);
  }

  return value;
}

export function parseVenueRentalFeeCents(value: unknown): number {
  if (value === undefined) {
    throw new VenueRentalPaymentInputError("feeCents is required");
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VenueRentalPaymentInputError(
      "feeCents must be a finite number of cents",
    );
  }

  if (!Number.isInteger(value)) {
    throw new VenueRentalPaymentInputError(
      "feeCents must be an integer number of cents",
    );
  }

  if (value <= 0) {
    throw new VenueRentalPaymentInputError("feeCents must be greater than 0");
  }

  if (value > MAX_VENUE_RENTAL_AMOUNT_CENTS) {
    throw new VenueRentalPaymentInputError(
      `feeCents must be less than or equal to ${MAX_VENUE_RENTAL_AMOUNT_CENTS}`,
    );
  }

  return value;
}

export function parseVenueRentalDepositCents(value: unknown): number {
  if (value === undefined) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VenueRentalPaymentInputError(
      "depositCents must be a finite number of cents",
    );
  }

  if (!Number.isInteger(value)) {
    throw new VenueRentalPaymentInputError(
      "depositCents must be an integer number of cents",
    );
  }

  if (value < 0) {
    throw new VenueRentalPaymentInputError(
      "depositCents must be greater than or equal to 0",
    );
  }

  if (value > MAX_VENUE_RENTAL_AMOUNT_CENTS) {
    throw new VenueRentalPaymentInputError(
      `depositCents must be less than or equal to ${MAX_VENUE_RENTAL_AMOUNT_CENTS}`,
    );
  }

  return value;
}

export function assertVenueRentalPaymentIssuable(
  event: IssuableVenueRentalPaymentState,
): void {
  if (event.dealType !== "PAID_RENTAL") {
    throw new VenueRentalPaymentStateError(
      400,
      "Venue rental payments only apply to PAID_RENTAL deals.",
    );
  }

  if (event.rentalPaymentStatus === "paid") {
    throw new VenueRentalPaymentStateError(
      409,
      "This venue rental has already been paid. A new payment link cannot be issued.",
    );
  }

  if (event.rentalPaymentLinkId) {
    throw new VenueRentalPaymentStateError(
      409,
      "An unpaid rental payment link already exists. Deactivate it with DELETE before issuing a new one.",
    );
  }
}

export function assertVenueRentalPaymentClearable(
  event: ClearableVenueRentalPaymentState,
): string {
  if (!event.rentalPaymentLinkId) {
    throw new VenueRentalPaymentStateError(
      400,
      "No rental payment link exists to deactivate for this venue event.",
    );
  }

  if (event.rentalPaymentStatus === "paid") {
    throw new VenueRentalPaymentStateError(
      409,
      "This venue rental has already been paid. Its payment link record cannot be cleared.",
    );
  }

  return event.rentalPaymentLinkId;
}

export async function createVenueRentalPaymentLink(
  stripeClient: Stripe,
  options: {
    eventId: string;
    eventTitle: string;
    feeCents: number;
    depositCents: number;
    returnUrl: string | null;
  },
): Promise<StripeVenueRentalPaymentLink> {
  const feePrice = await stripeClient.prices.create({
    currency: "usd",
    unit_amount: options.feeCents,
    product_data: {
      name: `Venue rental — ${options.eventTitle}`,
    },
  });
  const feePriceId = requireNonEmptyString(
    feePrice.id,
    "price id for the venue rental fee",
  );

  let depositPriceId: string | null = null;

  if (options.depositCents > 0) {
    const depositPrice = await stripeClient.prices.create({
      currency: "usd",
      unit_amount: options.depositCents,
      product_data: {
        name: "Refundable security deposit",
      },
    });
    depositPriceId = requireNonEmptyString(
      depositPrice.id,
      "price id for the refundable security deposit",
    );
  }

  const paymentLink = await stripeClient.paymentLinks.create(
    buildVenueRentalPaymentLinkParams({
      eventId: options.eventId,
      feePriceId,
      depositPriceId,
      returnUrl: options.returnUrl,
    }),
  );

  return {
    linkId: requireNonEmptyString(paymentLink.id, "payment link id"),
    url: requireNonEmptyString(paymentLink.url, "payment link url"),
  };
}

function isStripeNotFoundError(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.statusCode === 404
  );
}

export async function deactivateVenueRentalPaymentLink(
  stripeClient: Stripe,
  linkId: string,
): Promise<"deactivated" | "missing"> {
  try {
    const paymentLink = await stripeClient.paymentLinks.update(linkId, {
      active: false,
    });

    requireNonEmptyString(paymentLink.id, "payment link id");
    return "deactivated";
  } catch (error: unknown) {
    if (isStripeNotFoundError(error)) {
      return "missing";
    }

    throw error;
  }
}

export function serializeVenueRentalPayment(record: VenueRentalPaymentRecord) {
  return {
    rentalFeeCents: record.rentalFeeCents,
    rentalDepositCents: record.rentalDepositCents,
    rentalPaymentLinkId: record.rentalPaymentLinkId,
    rentalPaymentUrl: record.rentalPaymentUrl,
    rentalPaymentStatus: record.rentalPaymentStatus,
  };
}
