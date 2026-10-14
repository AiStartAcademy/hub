import { randomUUID } from "node:crypto";

import { brand } from "@/config/brand";
import { buildBookingIcs, leadBookingIcsFilename } from "@/lib/bookingIcs";
import { appUrl } from "@/lib/drip/engine";
import {
  deleteLeadBookingFromGcal,
  syncLeadBookingToGcal,
} from "@/lib/googleCalendar";
import { logger } from "@/lib/logger";
import { escapeHtml, sendMail } from "@/lib/mail";
import prisma from "@/lib/prisma";
import { getSecret } from "@/lib/secrets";
import { intervalsOverlap } from "@/lib/sessionInstant";
import { createOneOffZoomMeeting, deleteZoomMeeting } from "@/lib/zoom";

const CONFIRMED = "CONFIRMED";
const CANCELLED = "CANCELLED";
const INTEGRATION_ERROR_LIMIT = 2_000;

export class LeadBookingSlotTakenError extends Error {
  readonly code = "SLOT_TAKEN";

  constructor(message = "The selected booking slot is no longer available", options?: ErrorOptions) {
    super(message, options);
    this.name = "LeadBookingSlotTakenError";
  }
}

export class LeadBookingSlotNotFoundError extends Error {
  readonly code = "SLOT_NOT_FOUND";

  constructor(slotId: string) {
    super(`Lead-booking slot not found: ${slotId}`);
    this.name = "LeadBookingSlotNotFoundError";
  }
}

export type CreateLeadBookingInput = {
  slotId: string;
  name: string;
  email: string;
  phone?: string | null;
  note?: string | null;
};

export type CancelLeadBookingResult =
  | { ok: false; reason: "not_found" }
  | {
      ok: true;
      bookingId: string;
      alreadyCancelled: boolean;
      sideEffectErrors: string[];
    };

type BookingMailRecord = {
  id: string;
  cancelToken: string;
  notes: string | null;
  zoomJoinUrl: string;
  contact: { name: string; email: string; phone: string | null };
  slot: {
    startAt: Date;
    endAt: Date;
    timezone: string;
    closer: { name: string | null; email: string };
  };
};

type CancellationMailRecord = Pick<BookingMailRecord, "contact" | "slot">;

export async function listBookableSlots(closerId: string) {
  const now = new Date();
  const [candidateSlots, confirmedBookings] = await Promise.all([
    prisma.closerSlot.findMany({
      where: { closerId, startAt: { gt: now } },
      orderBy: { startAt: "asc" },
      include: { booking: { select: { status: true } } },
    }),
    prisma.leadBooking.findMany({
      where: {
        status: CONFIRMED,
        slot: { endAt: { gt: now } },
      },
      select: {
        slot: { select: { startAt: true, endAt: true } },
      },
    }),
  ]);

  return candidateSlots
    .filter((slot) => slot.booking?.status !== CONFIRMED)
    .filter(
      (slot) =>
        !confirmedBookings.some((booking) =>
          intervalsOverlap(
            { startUtc: slot.startAt, endUtc: slot.endAt },
            { startUtc: booking.slot.startAt, endUtc: booking.slot.endAt },
          ),
        ),
    )
    .map(({ booking: _booking, ...slot }) => slot);
}

export async function createLeadBooking(input: CreateLeadBookingInput) {
  const slotId = input.slotId.trim();
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() || null;
  const notes = input.note?.trim() || null;

  if (!slotId) throw new Error("createLeadBooking: slotId is required");
  if (!name) throw new Error("createLeadBooking: name is required");
  if (!email) throw new Error("createLeadBooking: email is required");

  let reservedBooking;
  try {
    reservedBooking = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const slot = await tx.closerSlot.findUnique({
        where: { id: slotId },
        include: {
          booking: { select: { status: true } },
          closer: { select: { id: true, name: true, email: true } },
        },
      });

      if (!slot) throw new LeadBookingSlotNotFoundError(slotId);
      if (slot.startAt.getTime() <= now.getTime()) {
        throw new LeadBookingSlotTakenError("The selected booking slot is no longer in the future");
      }
      if (slot.endAt.getTime() <= slot.startAt.getTime()) {
        throw new Error(`Lead-booking slot ${slot.id} has an invalid time range`);
      }
      if (slot.booking?.status === CONFIRMED) {
        throw new LeadBookingSlotTakenError();
      }

      const confirmedBookings = await tx.leadBooking.findMany({
        where: {
          status: CONFIRMED,
          slot: { endAt: { gt: now } },
        },
        select: {
          slot: { select: { startAt: true, endAt: true } },
        },
      });
      const overlapsConfirmedBooking = confirmedBookings.some((booking) =>
        intervalsOverlap(
          { startUtc: slot.startAt, endUtc: slot.endAt },
          { startUtc: booking.slot.startAt, endUtc: booking.slot.endAt },
        ),
      );
      if (overlapsConfirmedBooking) {
        throw new LeadBookingSlotTakenError(
          "The selected booking slot overlaps another confirmed booking",
        );
      }

      const contact = await tx.contact.upsert({
        where: { email },
        create: {
          email,
          name,
          phone,
          source: "booking",
          lastActivityAt: now,
        },
        update: { lastActivityAt: now },
        select: { id: true, name: true, email: true, phone: true },
      });

      return tx.leadBooking.create({
        data: {
          slotId: slot.id,
          contactId: contact.id,
          status: CONFIRMED,
          notes,
        },
        include: {
          contact: true,
          slot: { include: { closer: true } },
        },
      });
    });
  } catch (error) {
    if (isSlotUniqueViolation(error)) {
      throw new LeadBookingSlotTakenError(undefined, { cause: error });
    }
    throw error;
  }

  const leadName = reservedBooking.contact.name.trim() || reservedBooking.contact.email;
  const closerName =
    reservedBooking.slot.closer.name?.trim() || reservedBooking.slot.closer.email;
  const topic = `${brand.shortName} 1:1 — ${leadName} × ${closerName}`;
  const durationMin = Math.ceil(
    (reservedBooking.slot.endAt.getTime() - reservedBooking.slot.startAt.getTime()) / 60_000,
  );

  let zoomMeeting;
  try {
    zoomMeeting = await createOneOffZoomMeeting({
      topic,
      startTimeIso: reservedBooking.slot.startAt.toISOString(),
      durationMin,
      timezone: reservedBooking.slot.timezone,
    });
  } catch (error) {
    try {
      await prisma.leadBooking.delete({ where: { id: reservedBooking.id } });
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Zoom creation and reservation rollback both failed for lead booking ${reservedBooking.id}`,
      );
    }
    throw new Error(`Failed to create Zoom meeting for lead booking ${reservedBooking.id}`, {
      cause: error,
    });
  }

  try {
    await prisma.leadBooking.update({
      where: { id: reservedBooking.id },
      data: {
        zoomMeetingId: String(zoomMeeting.id),
        zoomJoinUrl: zoomMeeting.joinUrl,
      },
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [error];
    try {
      await deleteZoomMeeting(String(zoomMeeting.id));
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await prisma.leadBooking.delete({ where: { id: reservedBooking.id } });
    } catch (rollbackError) {
      cleanupErrors.push(rollbackError);
    }
    throw new AggregateError(
      cleanupErrors,
      `Failed to persist Zoom meeting for lead booking ${reservedBooking.id}`,
    );
  }

  const integrationErrors: string[] = [];
  const gcalResult = await syncLeadBookingToGcal(reservedBooking.id);
  if (gcalResult.outcome === "failed") {
    integrationErrors.push(`Google Calendar: ${gcalResult.error ?? "unknown sync failure"}`);
  }

  const bookingWithZoom = {
    ...reservedBooking,
    zoomMeetingId: String(zoomMeeting.id),
    zoomJoinUrl: zoomMeeting.joinUrl,
  };
  await captureBestEffortFailure(
    integrationErrors,
    "lead confirmation email",
    () => sendLeadConfirmation(bookingWithZoom, topic),
    { bookingId: reservedBooking.id, email: reservedBooking.contact.email },
  );
  await captureBestEffortFailure(
    integrationErrors,
    "closer notification email",
    () => sendCloserConfirmation(bookingWithZoom),
    { bookingId: reservedBooking.id, email: reservedBooking.slot.closer.email },
  );
  await persistIntegrationErrors(reservedBooking.id, integrationErrors);

  const completedBooking = await prisma.leadBooking.findUnique({
    where: { id: reservedBooking.id },
    include: {
      contact: true,
      slot: { include: { closer: true } },
    },
  });
  if (!completedBooking) {
    throw new Error(`Lead booking ${reservedBooking.id} disappeared after creation`);
  }
  return completedBooking;
}

export async function cancelLeadBooking(cancelToken: string): Promise<CancelLeadBookingResult> {
  const token = cancelToken.trim();
  if (!token) return { ok: false, reason: "not_found" };

  const booking = await prisma.leadBooking.findUnique({
    where: { cancelToken: token },
    include: {
      contact: true,
      slot: { include: { closer: true } },
    },
  });
  if (!booking) return { ok: false, reason: "not_found" };
  if (booking.status === CANCELLED) {
    return {
      ok: true,
      bookingId: booking.id,
      alreadyCancelled: true,
      sideEffectErrors: [],
    };
  }
  if (booking.status !== CONFIRMED) {
    throw new Error(`Cannot cancel lead booking ${booking.id} with status ${booking.status}`);
  }

  const cancelled = await prisma.leadBooking.updateMany({
    where: { id: booking.id, status: CONFIRMED },
    data: { status: CANCELLED },
  });
  if (cancelled.count === 0) {
    const current = await prisma.leadBooking.findUnique({
      where: { id: booking.id },
      select: { status: true },
    });
    if (current?.status === CANCELLED) {
      return {
        ok: true,
        bookingId: booking.id,
        alreadyCancelled: true,
        sideEffectErrors: [],
      };
    }
    throw new Error(`Lead booking ${booking.id} changed state before it could be cancelled`);
  }

  const sideEffectErrors: string[] = [];
  if (booking.zoomMeetingId) {
    const zoomMeetingId = booking.zoomMeetingId;
    await captureBestEffortFailure(
      sideEffectErrors,
      "Zoom deletion",
      () => deleteZoomMeeting(zoomMeetingId),
      { bookingId: booking.id, zoomMeetingId },
    );
  }

  try {
    const result = await deleteLeadBookingFromGcal(booking.id);
    if (result.outcome === "failed") {
      sideEffectErrors.push(
        `Google Calendar deletion: ${result.error ?? "unknown deletion failure"}`,
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to durably record Google Calendar deletion failure for lead booking ${booking.id}`,
      { cause: error },
    );
  }

  await captureBestEffortFailure(
    sideEffectErrors,
    "closer cancellation email",
    () => sendCloserCancellation(booking),
    { bookingId: booking.id, email: booking.slot.closer.email },
  );
  await persistIntegrationErrors(booking.id, sideEffectErrors);

  return {
    ok: true,
    bookingId: booking.id,
    alreadyCancelled: false,
    sideEffectErrors,
  };
}

export async function ensureContactPublicToken(contactId: string): Promise<string> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { publicToken: true },
  });
  if (!contact) throw new Error(`Cannot mint public token: contact ${contactId} was not found`);
  if (contact.publicToken) return contact.publicToken;

  const token = randomUUID();
  const claimed = await prisma.contact.updateMany({
    where: { id: contactId, publicToken: null },
    data: { publicToken: token },
  });
  if (claimed.count === 1) return token;

  const concurrentlyMinted = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { publicToken: true },
  });
  if (concurrentlyMinted?.publicToken) return concurrentlyMinted.publicToken;
  throw new Error(`Failed to mint public token for contact ${contactId}`);
}

export async function ensureBookingToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { bookingToken: true },
  });
  if (!user) throw new Error(`Cannot mint booking token: user ${userId} was not found`);
  if (user.bookingToken) return user.bookingToken;

  const token = randomUUID();
  const claimed = await prisma.user.updateMany({
    where: { id: userId, bookingToken: null },
    data: { bookingToken: token },
  });
  if (claimed.count === 1) return token;

  const concurrentlyMinted = await prisma.user.findUnique({
    where: { id: userId },
    select: { bookingToken: true },
  });
  if (concurrentlyMinted?.bookingToken) return concurrentlyMinted.bookingToken;
  throw new Error(`Failed to mint booking token for user ${userId}`);
}

function isSlotUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if ((error as { code?: unknown }).code !== "P2002") return false;

  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null || !("target" in meta)) return true;
  const target = (meta as { target?: unknown }).target;
  if (Array.isArray(target)) return target.includes("slotId");
  return typeof target === "string" ? target.includes("slotId") : true;
}

async function captureBestEffortFailure(
  errors: string[],
  operation: string,
  run: () => Promise<void>,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = `${operation}: ${errorMessage(error)}`;
    errors.push(message);
    logger.error({ err: error, ...context }, `[leadBooking] ${operation} failed`);
  }
}

async function persistIntegrationErrors(bookingId: string, errors: string[]): Promise<void> {
  const message = errors.length > 0 ? errors.join("; ").slice(0, INTEGRATION_ERROR_LIMIT) : null;
  try {
    await prisma.leadBooking.update({
      where: { id: bookingId },
      data: { gcalSyncError: message },
    });
  } catch (error) {
    logger.error(
      { err: error, bookingId, integrationErrors: errors },
      "[leadBooking] Failed to persist integration errors",
    );
    throw new Error(`Failed to persist integration errors for lead booking ${bookingId}`, {
      cause: error,
    });
  }
}

async function sendLeadConfirmation(
  booking: BookingMailRecord,
  topic: string,
): Promise<void> {
  const when = formatBookingTime(
    booking.slot.startAt,
    booking.slot.endAt,
    booking.slot.timezone,
  );
  const cancelUrl = `${appUrl()}/book/cancel/${encodeURIComponent(booking.cancelToken)}`;
  const leadName = booking.contact.name.trim() || booking.contact.email;
  await sendMail({
    to: booking.contact.email,
    subject: `Your ${brand.shortName} 1:1 is confirmed`,
    from: (await getSecret("MAIL_FROM"))?.trim() || undefined,
    replyTo: booking.slot.closer.email,
    html: `
      <p>Hi ${escapeHtml(leadName)},</p>
      <p>Your 1:1 with ${escapeHtml(booking.slot.closer.name?.trim() || booking.slot.closer.email)} is confirmed for ${escapeHtml(when)}.</p>
      <p><a href="${escapeHtml(booking.zoomJoinUrl)}">Join the Zoom meeting</a></p>
      <p>If your plans change, <a href="${escapeHtml(cancelUrl)}">cancel your booking</a>.</p>
    `,
    attachments: [
      {
        filename: leadBookingIcsFilename(brand.ids.icsFilePrefix),
        content: buildBookingIcs({
          id: booking.id,
          startAt: booking.slot.startAt,
          endAt: booking.slot.endAt,
          summary: topic,
          zoomJoinUrl: booking.zoomJoinUrl,
        }),
        contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      },
    ],
  });
}

async function sendCloserConfirmation(booking: BookingMailRecord): Promise<void> {
  const when = formatBookingTime(
    booking.slot.startAt,
    booking.slot.endAt,
    booking.slot.timezone,
  );
  await sendMail({
    to: booking.slot.closer.email,
    subject: `New ${brand.shortName} 1:1 booking — ${booking.contact.name}`,
    from: (await getSecret("MAIL_FROM"))?.trim() || undefined,
    replyTo: booking.contact.email,
    html: `
      <p>${escapeHtml(booking.contact.name)} booked a ${escapeHtml(brand.shortName)} 1:1 for ${escapeHtml(when)}.</p>
      <p>Email: <a href="mailto:${escapeHtml(booking.contact.email)}">${escapeHtml(booking.contact.email)}</a>${booking.contact.phone ? `<br>Phone: ${escapeHtml(booking.contact.phone)}` : ""}</p>
      ${booking.notes ? `<p>Note: ${escapeHtml(booking.notes)}</p>` : ""}
      <p><a href="${escapeHtml(booking.zoomJoinUrl)}">Join the Zoom meeting</a></p>
    `,
  });
}

async function sendCloserCancellation(
  booking: CancellationMailRecord,
): Promise<void> {
  const when = formatBookingTime(
    booking.slot.startAt,
    booking.slot.endAt,
    booking.slot.timezone,
  );
  await sendMail({
    to: booking.slot.closer.email,
    subject: `${brand.shortName} 1:1 cancelled — ${booking.contact.name}`,
    from: (await getSecret("MAIL_FROM"))?.trim() || undefined,
    replyTo: booking.contact.email,
    html: `
      <p>${escapeHtml(booking.contact.name)} cancelled the ${escapeHtml(brand.shortName)} 1:1 scheduled for ${escapeHtml(when)}.</p>
      <p>Email: <a href="mailto:${escapeHtml(booking.contact.email)}">${escapeHtml(booking.contact.email)}</a></p>
    `,
  });
}

function formatBookingTime(startAt: Date, endAt: Date, timezone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(startAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${date}, ${time.format(startAt)}–${time.format(endAt)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
