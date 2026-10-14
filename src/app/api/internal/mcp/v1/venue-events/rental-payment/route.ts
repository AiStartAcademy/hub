import { NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { mcpError, mcpJson, mcpWritesEnabled, requireMcpToken } from "@/lib/mcpApi";
import prisma from "@/lib/prisma";
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

const POST_BODY_KEYS = new Set(["venueEventId", "feeCents", "depositCents"]);
const DELETE_BODY_KEYS = new Set(["venueEventId"]);

const RENTAL_PAYMENT_SELECT = {
  rentalFeeCents: true,
  rentalDepositCents: true,
  rentalPaymentLinkId: true,
  rentalPaymentUrl: true,
  rentalPaymentStatus: true,
} satisfies Record<keyof VenueRentalPaymentRecord, true>;

type JsonRecord = Record<string, unknown>;

type RentalPaymentRequestBody = {
  venueEventId?: unknown;
  feeCents?: unknown;
  depositCents?: unknown;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown error";
}

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripeUnavailableResponse() {
  return mcpError(
    "Stripe is not configured on this server. Set STRIPE_SECRET_KEY before creating or deactivating venue rental payment links.",
    503,
  );
}

async function parseRequestBody(
  req: NextRequest,
  allowedKeys: Set<string>,
): Promise<RentalPaymentRequestBody | Response> {
  let parsedBody: unknown;

  try {
    parsedBody = await req.json();
  } catch (error: unknown) {
    return mcpError(`Invalid JSON body: ${getErrorMessage(error)}`, 400);
  }

  if (!isPlainObject(parsedBody)) {
    return mcpError("Request body must be a JSON object", 400);
  }

  for (const key of Object.keys(parsedBody)) {
    if (!allowedKeys.has(key)) {
      return mcpError(`Unknown body key \`${key}\``, 400);
    }
  }

  return parsedBody;
}

function parseVenueEventId(body: RentalPaymentRequestBody): string | Response {
  if (typeof body.venueEventId !== "string" || !body.venueEventId.trim()) {
    return mcpError("venueEventId is required and must be a string", 400);
  }

  return body.venueEventId.trim();
}

export async function POST(req: NextRequest) {
  const denied = await requireMcpToken(req);
  if (denied) {
    return denied;
  }

  if (!(await mcpWritesEnabled())) {
    logger.error(
      { operation: "POST" },
      "venue rental payment POST denied because MCP writes are disabled",
    );
    return mcpError("MCP writes are disabled", 403);
  }

  if (!stripeConfigured) {
    return stripeUnavailableResponse();
  }

  try {
    const parsedBody = await parseRequestBody(req, POST_BODY_KEYS);
    if (parsedBody instanceof Response) {
      return parsedBody;
    }

    const venueEventId = parseVenueEventId(parsedBody);
    if (venueEventId instanceof Response) {
      return venueEventId;
    }

    let feeCents: number;
    let depositCents: number;

    try {
      feeCents = parseVenueRentalFeeCents(parsedBody.feeCents);
      depositCents = parseVenueRentalDepositCents(parsedBody.depositCents);
    } catch (error: unknown) {
      if (error instanceof VenueRentalPaymentInputError) {
        return mcpError(error.message, 400);
      }
      throw error;
    }

    const event = await prisma.venueEvent.findUnique({
      where: { id: venueEventId },
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
      return mcpError("Venue event not found", 404);
    }

    try {
      assertVenueRentalPaymentIssuable(event);
    } catch (error: unknown) {
      if (error instanceof VenueRentalPaymentStateError) {
        return mcpError(error.message, error.status);
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
        "[mcp venue-events rental-payment] Stripe link created",
      );
    } catch (error: unknown) {
      logger.error(
        { err: error, venueEventId: event.id },
        "[mcp venue-events rental-payment] Stripe create failed",
      );
      return mcpError(
        `Stripe failed to create the rental payment link: ${getErrorMessage(error)}`,
        502,
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
        select: RENTAL_PAYMENT_SELECT,
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

    return mcpJson(serializeVenueRentalPayment(updatedEvent));
  } catch (error: unknown) {
    logger.error(
      { err: error },
      "Failed to create venue rental payment link via MCP",
    );
    return mcpError("Internal server error", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireMcpToken(req);
  if (denied) {
    return denied;
  }

  if (!(await mcpWritesEnabled())) {
    logger.error(
      { operation: "DELETE" },
      "venue rental payment DELETE denied because MCP writes are disabled",
    );
    return mcpError("MCP writes are disabled", 403);
  }

  if (!stripeConfigured) {
    return stripeUnavailableResponse();
  }

  try {
    const parsedBody = await parseRequestBody(req, DELETE_BODY_KEYS);
    if (parsedBody instanceof Response) {
      return parsedBody;
    }

    const venueEventId = parseVenueEventId(parsedBody);
    if (venueEventId instanceof Response) {
      return venueEventId;
    }

    const event = await prisma.venueEvent.findUnique({
      where: { id: venueEventId },
      select: {
        id: true,
        rentalPaymentLinkId: true,
        rentalPaymentStatus: true,
      },
    });

    if (!event) {
      return mcpError("Venue event not found", 404);
    }

    let rentalPaymentLinkId: string;

    try {
      rentalPaymentLinkId = assertVenueRentalPaymentClearable(event);
    } catch (error: unknown) {
      if (error instanceof VenueRentalPaymentStateError) {
        return mcpError(error.message, error.status);
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
          "[mcp venue-events rental-payment] Stripe link missing during deactivate; clearing local fields",
        );
      }
    } catch (error: unknown) {
      logger.error(
        { err: error, venueEventId: event.id, rentalPaymentLinkId: event.rentalPaymentLinkId },
        "[mcp venue-events rental-payment] Stripe deactivate failed",
      );
      return mcpError(
        `Stripe failed to deactivate the rental payment link: ${getErrorMessage(error)}`,
        502,
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
        select: RENTAL_PAYMENT_SELECT,
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

    return mcpJson(serializeVenueRentalPayment(updatedEvent));
  } catch (error: unknown) {
    logger.error(
      { err: error },
      "Failed to deactivate venue rental payment link via MCP",
    );
    return mcpError("Internal server error", 500);
  }
}
