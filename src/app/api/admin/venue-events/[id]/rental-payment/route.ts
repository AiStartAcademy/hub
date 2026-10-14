import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { findLatestAgreementTokenForEvent } from "@/lib/venueAgreementLookup";
import { buildAgreementReturnUrl } from "@/lib/venueAgreementPayment";
import {
  assertVenueRentalPaymentClearable,
  assertVenueRentalPaymentIssuable,
  createVenueRentalPaymentLink,
  deactivateVenueRentalPaymentLink,
  parseVenueRentalDepositCents,
  parseVenueRentalFeeCents,
  serializeVenueRentalPayment,
  type StripeVenueRentalPaymentLink,
  type VenueRentalPaymentRecord,
  VenueRentalPaymentInputError,
  VenueRentalPaymentStateError,
} from "@/lib/venueRentalPayment";
import { buildPendingVenueRentalPayment } from "@/lib/venueRentalRecord";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RentalPaymentRequestBody = {
  feeCents?: unknown;
  depositCents?: unknown;
};

const ALLOWED_BODY_KEYS = new Set(["feeCents", "depositCents"]);

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripeUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Stripe is not configured on this server. Set STRIPE_SECRET_KEY before creating or deactivating venue rental payment links.",
    },
    { status: 503 },
  );
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const session = await auth();

    if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!stripeConfigured) {
      return stripeUnavailableResponse();
    }

    const { id } = await params;

    let body: RentalPaymentRequestBody;

    try {
      const parsedBody = (await request.json()) as unknown;

      if (!isPlainObject(parsedBody)) {
        return NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 },
        );
      }

      for (const key of Object.keys(parsedBody)) {
        if (!ALLOWED_BODY_KEYS.has(key)) {
          return NextResponse.json(
            { error: `Unknown field: ${key}` },
            { status: 400 },
          );
        }
      }

      body = parsedBody;
    } catch (error: unknown) {
      return NextResponse.json(
        { error: `Invalid JSON body: ${getErrorMessage(error)}` },
        { status: 400 },
      );
    }

    let feeCents: number;
    let depositCents: number;

    try {
      feeCents = parseVenueRentalFeeCents(body.feeCents);
      depositCents = parseVenueRentalDepositCents(body.depositCents);
    } catch (error: unknown) {
      if (error instanceof VenueRentalPaymentInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const event = await prisma.venueEvent.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        dealType: true,
        organizerName: true,
        contactEmail: true,
        rentalPaymentLinkId: true,
        rentalPaymentStatus: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Venue event not found" }, { status: 404 });
    }

    try {
      assertVenueRentalPaymentIssuable(event);
    } catch (error: unknown) {
      if (error instanceof VenueRentalPaymentStateError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const agreementToken = await findLatestAgreementTokenForEvent(event.id);
    const returnUrl = agreementToken
      ? buildAgreementReturnUrl(agreementToken)
      : null;

    let paymentLink: StripeVenueRentalPaymentLink;

    try {
      paymentLink = await createVenueRentalPaymentLink(stripe, {
        eventId: event.id,
        eventTitle: event.title,
        feeCents,
        depositCents,
        returnUrl,
      });
      logger.info(
        { venueEventId: event.id, tiedToAgreement: agreementToken !== null },
        "[admin venue-events rental-payment] Stripe link created",
      );
    } catch (error: unknown) {
      logger.error(
        { err: error, venueEventId: event.id },
        "[admin venue-events rental-payment] Stripe create failed",
      );

      return NextResponse.json(
        { error: `Stripe failed to create the rental payment link: ${getErrorMessage(error)}` },
        { status: 502 },
      );
    }

    // The pending Payment placeholder is what makes the rental visible on
    // /admin/sales before any money moves; the webhook claims and flips it to
    // `paid` when the Checkout Session completes.
    const [updatedEvent] = await prisma.$transaction([
      prisma.venueEvent.update({
        where: { id: event.id },
        data: {
          rentalFeeCents: feeCents,
          rentalDepositCents: depositCents > 0 ? depositCents : null,
          rentalPaymentLinkId: paymentLink.linkId,
          rentalPaymentUrl: paymentLink.url,
          rentalPaymentStatus: "pending",
        },
        select: {
          rentalFeeCents: true,
          rentalDepositCents: true,
          rentalPaymentLinkId: true,
          rentalPaymentUrl: true,
          rentalPaymentStatus: true,
        },
      }),
      prisma.payment.create({
        data: buildPendingVenueRentalPayment({
          venueEventId: event.id,
          paymentLinkId: paymentLink.linkId,
          feeCents,
          depositCents,
          contactEmail: event.contactEmail,
          organizerName: event.organizerName,
        }),
      }),
    ]);

    return NextResponse.json(
      serializeVenueRentalPayment(updatedEvent as VenueRentalPaymentRecord),
    );
  } catch (error: unknown) {
    logger.error({ err: error }, "Failed to create venue rental payment link");

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const session = await auth();

    if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!stripeConfigured) {
      return stripeUnavailableResponse();
    }

    const { id } = await params;

    const event = await prisma.venueEvent.findUnique({
      where: { id },
      select: {
        id: true,
        rentalPaymentLinkId: true,
        rentalPaymentStatus: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Venue event not found" }, { status: 404 });
    }

    let rentalPaymentLinkId: string;

    try {
      rentalPaymentLinkId = assertVenueRentalPaymentClearable(event);
    } catch (error: unknown) {
      if (error instanceof VenueRentalPaymentStateError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    try {
      const outcome = await deactivateVenueRentalPaymentLink(
        stripe,
        rentalPaymentLinkId,
      );

      if (outcome === "missing") {
        logger.warn(
          { venueEventId: event.id, rentalPaymentLinkId: event.rentalPaymentLinkId },
          "[admin venue-events rental-payment] Stripe link missing during deactivate; clearing local fields",
        );
      }
    } catch (error: unknown) {
      logger.error(
        { err: error, venueEventId: event.id, rentalPaymentLinkId: event.rentalPaymentLinkId },
        "[admin venue-events rental-payment] Stripe deactivate failed",
      );

      return NextResponse.json(
        { error: `Stripe failed to deactivate the rental payment link: ${getErrorMessage(error)}` },
        { status: 502 },
      );
    }

    // Deactivating the link abandons its unclaimed placeholder rows too, so
    // /admin/sales pending totals don't count money that can no longer arrive.
    const [updatedEvent] = await prisma.$transaction([
      prisma.venueEvent.update({
        where: { id: event.id },
        data: {
          rentalFeeCents: null,
          rentalDepositCents: null,
          rentalPaymentLinkId: null,
          rentalPaymentUrl: null,
          rentalPaymentStatus: null,
        },
        select: {
          rentalFeeCents: true,
          rentalDepositCents: true,
          rentalPaymentLinkId: true,
          rentalPaymentUrl: true,
          rentalPaymentStatus: true,
        },
      }),
      prisma.payment.updateMany({
        where: {
          venueEventId: event.id,
          stripeSessionId: null,
          status: "pending",
        },
        data: { status: "failed" },
      }),
    ]);

    return NextResponse.json(
      serializeVenueRentalPayment(updatedEvent as VenueRentalPaymentRecord),
    );
  } catch (error: unknown) {
    logger.error({ err: error }, "Failed to deactivate venue rental payment link");

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
