import { NextResponse } from "next/server";

import {
  createLeadBooking,
  LeadBookingSlotNotFoundError,
  LeadBookingSlotTakenError,
} from "@/lib/booking/leadBooking";
import { logger } from "@/lib/logger";
import {
  normalizeE164Phone,
  normalizeEmail,
  sanitizePlainText,
} from "@/lib/onboarding-security";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
const MAX_NAME_LENGTH = 200;
const MAX_NOTE_LENGTH = 500;

type BookingRequestBody = {
  slotId?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  note?: unknown;
};

function jsonError(message: string, status: number, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

function requestIp(req: Request): string {
  const firstForwardedIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return firstForwardedIp || "unknown";
}

function optionalText(value: unknown, maxLength: number, multiline = false): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  return sanitizePlainText(value, maxLength, { multiline }) || null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const rateLimit = checkRateLimit(
    `lead-booking:${token}:${requestIp(req)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (rateLimit.limited) {
    return jsonError("Too many booking attempts. Please try again later.", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  let body: BookingRequestBody;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Invalid request body.", 400);
    }
    body = parsed as BookingRequestBody;
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  const slotId = sanitizePlainText(body.slotId, 200);
  const nameCandidate = sanitizePlainText(body.name, MAX_NAME_LENGTH + 1);
  const email = normalizeEmail(body.email);
  const rawPhone = optionalText(body.phone, 33);
  const phone = rawPhone ? normalizeE164Phone(rawPhone) : null;
  const noteCandidate = optionalText(body.note, MAX_NOTE_LENGTH + 1, true);

  if (!slotId) return jsonError("A booking slot is required.", 400);
  if (!nameCandidate) return jsonError("Name is required.", 400);
  if (nameCandidate.length > MAX_NAME_LENGTH) {
    return jsonError(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`, 400);
  }
  if (!email) return jsonError("A valid email is required.", 400);
  if (
    body.phone !== undefined &&
    body.phone !== null &&
    typeof body.phone !== "string"
  ) {
    return jsonError("Phone must be text.", 400);
  }
  if (rawPhone && !phone) {
    return jsonError("Enter a valid phone number in international format, such as +14155552671.", 400);
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return jsonError("Note must be text.", 400);
  }
  if (noteCandidate && noteCandidate.length > MAX_NOTE_LENGTH) {
    return jsonError(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`, 400);
  }

  const closer = await prisma.user.findUnique({
    where: { bookingToken: token },
    select: { id: true },
  });
  if (!closer) return jsonError("Booking link not found.", 404);

  const ownedSlot = await prisma.closerSlot.findFirst({
    where: { id: slotId, closerId: closer.id },
    select: { id: true },
  });
  if (!ownedSlot) return jsonError("Booking slot not found.", 404);

  try {
    const booking = await createLeadBooking({
      slotId: ownedSlot.id,
      name: nameCandidate,
      email,
      phone,
      note: noteCandidate,
    });
    return NextResponse.json({
      ok: true,
      ...(booking.zoomJoinUrl ? { joinUrl: booking.zoomJoinUrl } : {}),
    });
  } catch (error) {
    if (error instanceof LeadBookingSlotTakenError) {
      return jsonError("slot just taken", 409);
    }
    if (error instanceof LeadBookingSlotNotFoundError) {
      return jsonError("Booking slot not found.", 404);
    }

    logger.error(
      { err: error, closerId: closer.id, slotId: ownedSlot.id },
      "[public booking] Failed to create lead booking",
    );
    return jsonError("We could not complete the booking. Please try again.", 500);
  }
}
