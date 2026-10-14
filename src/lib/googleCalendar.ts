/**
 * Google Calendar sync uses a dedicated OAuth refresh token for a real organizer mailbox because
 * a bare service account cannot invite external attendees unless Workspace domain-wide delegation
 * is configured and granted to the Calendar scopes we need.
 */

import { google } from "googleapis";

import { brand } from "@/config/brand";
import { parseProjectTimeToMinutes } from "@/lib/calendarUtils";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { sessionInterval } from "@/lib/sessionInstant";

export type GcalSyncOutcome = "skipped" | "created" | "updated" | "cancelled" | "failed";

export interface GcalSyncResult {
  outcome: GcalSyncOutcome;
  eventId: string | null;
  error: string | null;
}

type VenueEventRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  organizerName: string;
  orgName: string | null;
  contactEmail: string;
  date: Date;
  /** Last day of a multi-day event; null for single-day. */
  endDate?: Date | null;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string; // PENDING | APPROVED | DECLINED | CANCELLED — plain String column (SQLite)
  gcalEventId: string | null;
};

type GoogleEventResource = {
  summary: string;
  description: string;
  status: "tentative" | "confirmed";
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees?: Array<{ email: string }>;
};

const GOOGLE_TIMEOUT_MS = 10_000;
const HUB_BASE_URL = brand.urls.hub;

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID?.trim() ?? "";
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
const GOOGLE_OAUTH_REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim() ?? "";
const GOOGLE_CALENDAR_ORGANIZER_EMAIL =
  process.env.GOOGLE_CALENDAR_ORGANIZER_EMAIL?.trim() ?? "";

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    GOOGLE_CALENDAR_ID &&
      GOOGLE_OAUTH_CLIENT_ID &&
      GOOGLE_OAUTH_CLIENT_SECRET &&
      GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

export async function syncVenueEventToGcal(venueEventId: string): Promise<GcalSyncResult> {
  if (!isGoogleCalendarConfigured()) {
    logger.debug({ venueEventId }, "Skipping Google Calendar sync because configuration is missing");
    return { outcome: "skipped", eventId: null, error: null };
  }

  try {
    const venueEvent = await prisma.venueEvent.findUnique({
      where: { id: venueEventId },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        organizerName: true,
        orgName: true,
        contactEmail: true,
        date: true,
        endDate: true,
        startTime: true,
        endTime: true,
        timezone: true,
        status: true,
        gcalEventId: true,
      },
    });

    if (!venueEvent) {
      logger.warn({ venueEventId }, "Venue event not found for Google Calendar sync");
      return { outcome: "skipped", eventId: null, error: null };
    }

    const calendar = createCalendarClient();

    switch (venueEvent.status) {
      case "PENDING":
      case "APPROVED":
        return await upsertActiveEvent(calendar, venueEvent);
      case "DECLINED":
      case "CANCELLED":
        return await cancelEvent(calendar, venueEvent);
      default: {
        const error = `Unsupported venue event status: ${String(venueEvent.status)}`;
        logger.warn({ venueEventId, status: venueEvent.status }, error);
        await persistFailureState(venueEventId, error);
        return { outcome: "failed", eventId: venueEvent.gcalEventId, error };
      }
    }
  } catch (err) {
    const error = truncateErrorMessage(toErrorMessage(err));
    logger.error({ err, venueEventId }, "Google Calendar sync failed");
    await persistFailureState(venueEventId, error);
    return { outcome: "failed", eventId: null, error };
  }
}

export async function syncLeadBookingToGcal(bookingId: string): Promise<GcalSyncResult> {
  if (!isGoogleCalendarConfigured()) {
    logger.debug({ bookingId }, "Skipping lead-booking Google Calendar sync because configuration is missing");
    return { outcome: "skipped", eventId: null, error: null };
  }

  let storedEventId: string | null = null;
  try {
    const booking = await prisma.leadBooking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        zoomJoinUrl: true,
        gcalEventId: true,
        contact: { select: { name: true, email: true } },
        slot: {
          select: {
            startAt: true,
            endAt: true,
            timezone: true,
            closer: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!booking) {
      logger.warn({ bookingId }, "Lead booking not found for Google Calendar sync");
      return { outcome: "skipped", eventId: null, error: null };
    }

    storedEventId = booking.gcalEventId;
    if (booking.status === "CANCELLED") {
      return await deleteLeadBookingFromGcal(bookingId);
    }
    if (booking.status !== "CONFIRMED") {
      const error = `Unsupported lead booking status: ${booking.status}`;
      await persistLeadBookingFailureState(bookingId, error);
      logger.warn({ bookingId, status: booking.status }, error);
      return { outcome: "failed", eventId: booking.gcalEventId, error };
    }
    if (!booking.zoomJoinUrl?.trim()) {
      const error = "Lead booking has no Zoom join URL for Google Calendar sync";
      await persistLeadBookingFailureState(bookingId, error);
      logger.warn({ bookingId }, error);
      return { outcome: "failed", eventId: booking.gcalEventId, error };
    }

    const leadName = booking.contact.name.trim() || booking.contact.email;
    const closerName = booking.slot.closer.name?.trim() || booking.slot.closer.email;
    const attendees = buildUniqueAttendees([
      booking.contact.email,
      booking.slot.closer.email,
    ]);
    const requestBody: GoogleEventResource = {
      summary: `${brand.shortName} 1:1 — ${leadName} × ${closerName}`,
      description: `Join Zoom: ${booking.zoomJoinUrl}`,
      status: "confirmed",
      start: {
        dateTime: booking.slot.startAt.toISOString(),
        timeZone: booking.slot.timezone,
      },
      end: {
        dateTime: booking.slot.endAt.toISOString(),
        timeZone: booking.slot.timezone,
      },
      attendees,
    };
    const calendar = createCalendarClient();

    try {
      if (booking.gcalEventId) {
        const patched = await patchGoogleEvent(calendar, booking.gcalEventId, requestBody);
        await persistLeadBookingSuccessState(bookingId, patched.id);
        return { outcome: "updated", eventId: patched.id, error: null };
      }

      const inserted = await insertGoogleEvent(calendar, requestBody, "APPROVED");
      await persistLeadBookingSuccessState(bookingId, inserted.id);
      return { outcome: "created", eventId: inserted.id, error: null };
    } catch (error) {
      const statusCode = getGoogleStatusCode(error);
      if (booking.gcalEventId && (statusCode === 404 || statusCode === 410)) {
        logger.warn(
          { bookingId, gcalEventId: booking.gcalEventId, statusCode },
          "Stored lead-booking Google Calendar event was missing; recreating it once",
        );
        await prisma.leadBooking.update({
          where: { id: bookingId },
          data: { gcalEventId: null },
        });
        const inserted = await insertGoogleEvent(calendar, requestBody, "APPROVED");
        await persistLeadBookingSuccessState(bookingId, inserted.id);
        return { outcome: "created", eventId: inserted.id, error: null };
      }
      throw error;
    }
  } catch (error) {
    const message = truncateErrorMessage(toErrorMessage(error));
    logger.error({ err: error, bookingId }, "Google Calendar lead-booking sync failed");
    await persistLeadBookingFailureState(bookingId, message);
    return { outcome: "failed", eventId: storedEventId, error: message };
  }
}

export async function deleteLeadBookingFromGcal(bookingId: string): Promise<GcalSyncResult> {
  if (!isGoogleCalendarConfigured()) {
    logger.debug({ bookingId }, "Skipping lead-booking Google Calendar delete because configuration is missing");
    return { outcome: "skipped", eventId: null, error: null };
  }

  let storedEventId: string | null = null;
  try {
    const booking = await prisma.leadBooking.findUnique({
      where: { id: bookingId },
      select: { gcalEventId: true },
    });
    if (!booking) {
      logger.warn({ bookingId }, "Lead booking not found for Google Calendar deletion");
      return { outcome: "skipped", eventId: null, error: null };
    }

    storedEventId = booking.gcalEventId;
    if (!booking.gcalEventId) {
      return { outcome: "skipped", eventId: null, error: null };
    }

    const calendar = createCalendarClient();
    try {
      await deleteGoogleEvent(calendar, booking.gcalEventId);
    } catch (error) {
      const statusCode = getGoogleStatusCode(error);
      if (statusCode !== 404 && statusCode !== 410) throw error;
      logger.warn(
        { bookingId, gcalEventId: booking.gcalEventId, statusCode },
        "Lead-booking Google Calendar event was already missing while deleting",
      );
    }

    await persistLeadBookingSuccessState(bookingId, null);
    return { outcome: "cancelled", eventId: null, error: null };
  } catch (error) {
    const message = truncateErrorMessage(toErrorMessage(error));
    logger.error({ err: error, bookingId }, "Google Calendar lead-booking deletion failed");
    await persistLeadBookingFailureState(bookingId, message);
    return { outcome: "failed", eventId: storedEventId, error: message };
  }
}

/**
 * Mirror one CohortSession into Google Calendar as a single event whose attendees are
 * the instructors that have CONFIRMED it (plus the organizer mailbox).
 *
 * One event per session, not per instructor: a class is one thing on the calendar, and
 * re-syncing simply recomputes the attendee list. Nothing is created while a session is
 * still being negotiated — the event appears when the first instructor confirms, and is
 * cancelled if every confirmation goes away.
 */
export async function syncCohortSessionToGcal(sessionId: string): Promise<GcalSyncResult> {
  if (!isGoogleCalendarConfigured()) {
    logger.debug({ sessionId }, "Skipping Google Calendar sync because configuration is missing");
    return { outcome: "skipped", eventId: null, error: null };
  }

  try {
    const session = await prisma.cohortSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        title: true,
        description: true,
        date: true,
        startTime: true,
        endTime: true,
        timezone: true,
        meetingLink: true,
        gcalEventId: true,
        cohort: { select: { id: true, title: true, location: true, deliveryMode: true } },
        assignments: {
          where: { status: "CONFIRMED" },
          select: { cohortInstructor: { select: { instructor: { select: { email: true } } } } },
        },
      },
    });

    if (!session) {
      logger.warn({ sessionId }, "Cohort session not found for Google Calendar sync");
      return { outcome: "skipped", eventId: null, error: null };
    }

    const confirmedEmails = session.assignments
      .map((a) => a.cohortInstructor.instructor.email.trim())
      .filter(Boolean);

    const calendar = createCalendarClient();

    // No confirmations left — the class isn't staffed, so pull the invite.
    if (confirmedEmails.length === 0) {
      if (!session.gcalEventId) return { outcome: "skipped", eventId: null, error: null };
      try {
        await deleteGoogleEvent(calendar, session.gcalEventId);
      } catch (err) {
        const statusCode = getGoogleStatusCode(err);
        if (statusCode !== 404 && statusCode !== 410) throw err;
      }
      await persistSessionState(sessionId, { gcalEventId: null, gcalSyncedAt: new Date(), gcalSyncError: null });
      return { outcome: "cancelled", eventId: null, error: null };
    }

    const interval = sessionInterval(session);
    if (!interval) {
      const error = `Session times could not be parsed: "${session.startTime}"–"${session.endTime}"`;
      logger.warn({ sessionId }, error);
      await persistSessionState(sessionId, { gcalSyncError: truncateErrorMessage(error) });
      return { outcome: "failed", eventId: session.gcalEventId, error };
    }

    const attendees: Array<{ email: string }> = [];
    const seen = new Set<string>();
    for (const email of [...confirmedEmails, GOOGLE_CALENDAR_ORGANIZER_EMAIL]) {
      const trimmed = email.trim();
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      attendees.push({ email: trimmed });
    }

    const requestBody: GoogleEventResource = {
      summary: `${session.cohort.title} — ${session.title}`,
      description: [
        session.description?.trim() || null,
        session.meetingLink ? `Join: ${session.meetingLink}` : null,
        session.cohort.location ? `Location: ${session.cohort.location}` : null,
        "",
        `Your schedule: ${HUB_BASE_URL}/instructor-schedule`,
        `Admin view: ${HUB_BASE_URL}/admin/cohorts/participation`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
      status: "confirmed",
      start: { dateTime: interval.startUtc.toISOString(), timeZone: interval.ianaTz },
      end: { dateTime: interval.endUtc.toISOString(), timeZone: interval.ianaTz },
      attendees,
    };

    try {
      if (session.gcalEventId) {
        const patched = await patchGoogleEvent(calendar, session.gcalEventId, requestBody);
        await persistSessionState(sessionId, {
          gcalEventId: patched.id,
          gcalSyncedAt: new Date(),
          gcalSyncError: null,
        });
        return { outcome: "updated", eventId: patched.id, error: null };
      }
      const inserted = await insertGoogleEvent(calendar, requestBody, "APPROVED");
      await persistSessionState(sessionId, {
        gcalEventId: inserted.id,
        gcalSyncedAt: new Date(),
        gcalSyncError: null,
      });
      return { outcome: "created", eventId: inserted.id, error: null };
    } catch (err) {
      const statusCode = getGoogleStatusCode(err);
      // Someone deleted the event in Google directly — recreate it once.
      if (session.gcalEventId && (statusCode === 404 || statusCode === 410)) {
        await persistSessionState(sessionId, { gcalEventId: null });
        const inserted = await insertGoogleEvent(calendar, requestBody, "APPROVED");
        await persistSessionState(sessionId, {
          gcalEventId: inserted.id,
          gcalSyncedAt: new Date(),
          gcalSyncError: null,
        });
        return { outcome: "created", eventId: inserted.id, error: null };
      }
      throw err;
    }
  } catch (err) {
    const error = truncateErrorMessage(toErrorMessage(err));
    logger.error({ err, sessionId }, "Google Calendar cohort-session sync failed");
    await persistSessionState(sessionId, { gcalSyncError: error }).catch(() => {});
    return { outcome: "failed", eventId: null, error };
  }
}

async function persistSessionState(
  sessionId: string,
  data: { gcalEventId?: string | null; gcalSyncedAt?: Date; gcalSyncError?: string | null },
): Promise<void> {
  try {
    await prisma.cohortSession.update({ where: { id: sessionId }, data });
  } catch (persistErr) {
    logger.error({ err: persistErr, sessionId }, "Failed to persist cohort session gcal state");
  }
}

function buildUniqueAttendees(emails: string[]): Array<{ email: string }> {
  const attendees: Array<{ email: string }> = [];
  const seen = new Set<string>();
  for (const rawEmail of emails) {
    const email = rawEmail.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    attendees.push({ email });
  }
  return attendees;
}

async function persistLeadBookingSuccessState(
  bookingId: string,
  gcalEventId: string | null,
): Promise<void> {
  await prisma.leadBooking.update({
    where: { id: bookingId },
    data: { gcalEventId, gcalSyncError: null },
  });
}

async function persistLeadBookingFailureState(
  bookingId: string,
  error: string,
): Promise<void> {
  try {
    await prisma.leadBooking.update({
      where: { id: bookingId },
      data: { gcalSyncError: truncateErrorMessage(error) },
    });
  } catch (persistError) {
    logger.error(
      { err: persistError, bookingId, originalError: error },
      "Failed to persist lead-booking Google Calendar error",
    );
    throw new AggregateError(
      [persistError],
      `Failed to persist Google Calendar error for lead booking ${bookingId}: ${error}`,
    );
  }
}

function createCalendarClient() {
  const auth = new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
  );

  auth.setCredentials({
    refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
  });

  return google.calendar({
    version: "v3",
    auth,
  });
}

async function upsertActiveEvent(
  calendar: ReturnType<typeof google.calendar>,
  venueEvent: VenueEventRecord,
): Promise<GcalSyncResult> {
  const requestBody = buildGoogleEventResource(venueEvent);

  try {
    if (venueEvent.gcalEventId) {
      const patchResult = await patchGoogleEvent(calendar, venueEvent.gcalEventId, requestBody);
      await persistSuccessState(venueEvent.id, patchResult.id, false);
      return { outcome: "updated", eventId: patchResult.id, error: null };
    }

    const insertResult = await insertGoogleEvent(calendar, requestBody, venueEvent.status);
    await persistSuccessState(venueEvent.id, insertResult.id, false);
    return { outcome: "created", eventId: insertResult.id, error: null };
  } catch (err) {
    const statusCode = getGoogleStatusCode(err);

    if (venueEvent.gcalEventId && (statusCode === 404 || statusCode === 410)) {
      logger.warn(
        { venueEventId: venueEvent.id, gcalEventId: venueEvent.gcalEventId, statusCode },
        "Stored Google Calendar event was missing; recreating it once",
      );

      await clearStoredGoogleEventId(venueEvent.id);

      try {
        const insertResult = await insertGoogleEvent(calendar, requestBody, venueEvent.status);
        await persistSuccessState(venueEvent.id, insertResult.id, false);
        return { outcome: "created", eventId: insertResult.id, error: null };
      } catch (retryErr) {
        const error = truncateErrorMessage(toErrorMessage(retryErr));
        logger.error(
          { err: retryErr, venueEventId: venueEvent.id, gcalEventId: venueEvent.gcalEventId },
          "Google Calendar recreation after missing event failed",
        );
        await persistFailureState(venueEvent.id, error);
        return { outcome: "failed", eventId: null, error };
      }
    }

    const error = truncateErrorMessage(toErrorMessage(err));
    logger.error({ err, venueEventId: venueEvent.id }, "Google Calendar upsert failed");
    await persistFailureState(venueEvent.id, error);
    return { outcome: "failed", eventId: venueEvent.gcalEventId, error };
  }
}

async function cancelEvent(
  calendar: ReturnType<typeof google.calendar>,
  venueEvent: VenueEventRecord,
): Promise<GcalSyncResult> {
  if (!venueEvent.gcalEventId) {
    return { outcome: "skipped", eventId: null, error: null };
  }

  try {
    await deleteGoogleEvent(calendar, venueEvent.gcalEventId);
    await persistSuccessState(venueEvent.id, null, true);
    return { outcome: "cancelled", eventId: null, error: null };
  } catch (err) {
    const statusCode = getGoogleStatusCode(err);

    if (statusCode === 404 || statusCode === 410) {
      logger.warn(
        { venueEventId: venueEvent.id, gcalEventId: venueEvent.gcalEventId, statusCode },
        "Google Calendar event already missing while cancelling; clearing local reference",
      );
      await persistSuccessState(venueEvent.id, null, true);
      return { outcome: "cancelled", eventId: null, error: null };
    }

    const error = truncateErrorMessage(toErrorMessage(err));
    logger.error({ err, venueEventId: venueEvent.id }, "Google Calendar cancellation failed");
    await persistFailureState(venueEvent.id, error);
    return { outcome: "failed", eventId: venueEvent.gcalEventId, error };
  }
}

function buildGoogleEventResource(venueEvent: VenueEventRecord): GoogleEventResource {
  const dateParts = getUtcDateParts(venueEvent.date);
  // A multi-day event ends on its last day, so the calendar hold covers the
  // whole run rather than only the first evening.
  const isMultiDay = Boolean(
    venueEvent.endDate && venueEvent.endDate.getTime() > venueEvent.date.getTime(),
  );
  const endDateParts = isMultiDay ? getUtcDateParts(venueEvent.endDate!) : dateParts;

  const startMinutes = parseProjectTimeToMinutes(venueEvent.startTime);
  const rawEndMinutes = parseProjectTimeToMinutes(venueEvent.endTime);
  // Across days, an end-of-day clock earlier than the start is normal, not junk.
  const endMinutes =
    isMultiDay || rawEndMinutes > startMinutes
      ? rawEndMinutes
      : (() => {
          logger.warn(
            {
              venueEventId: venueEvent.id,
              startTime: venueEvent.startTime,
              endTime: venueEvent.endTime,
            },
            "Venue event end time was not after start time; using a one-hour fallback",
          );
          return startMinutes + 60;
        })();

  const attendees = buildAttendees(venueEvent);

  return {
    summary: venueEvent.status === "PENDING" ? `[HOLD] ${venueEvent.title}` : venueEvent.title,
    description: buildDescription(venueEvent),
    status: venueEvent.status === "PENDING" ? "tentative" : "confirmed",
    start: {
      dateTime: formatWallClockDateTime(dateParts, startMinutes),
      timeZone: venueEvent.timezone,
    },
    end: {
      dateTime: formatWallClockDateTime(endDateParts, endMinutes),
      timeZone: venueEvent.timezone,
    },
    ...(attendees.length > 0 ? { attendees } : {}),
  };
}

function buildDescription(venueEvent: VenueEventRecord): string {
  const lines = [
    `Organizer: ${venueEvent.organizerName}`,
    venueEvent.orgName ? `Organization: ${venueEvent.orgName}` : null,
    `Contact: ${venueEvent.contactEmail}`,
    venueEvent.description ? "" : null,
    venueEvent.description ? venueEvent.description.trim() : null,
    "",
    `Public event: ${HUB_BASE_URL}/events/${venueEvent.slug}`,
    `Admin view: ${HUB_BASE_URL}/admin/venue-events?event=${venueEvent.id}`,
  ];

  return lines.filter((line): line is string => line !== null).join("\n");
}

function buildAttendees(venueEvent: VenueEventRecord): Array<{ email: string }> {
  if (venueEvent.status !== "APPROVED") {
    return [];
  }

  const attendees: Array<{ email: string }> = [];
  const seen = new Set<string>();

  for (const rawEmail of [venueEvent.contactEmail, GOOGLE_CALENDAR_ORGANIZER_EMAIL]) {
    const email = rawEmail.trim();

    if (!email) {
      continue;
    }

    const dedupeKey = email.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    attendees.push({ email });
  }

  return attendees;
}

async function patchGoogleEvent(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string,
  requestBody: GoogleEventResource,
): Promise<{ id: string }> {
  const response = await withTimeout(
    calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      requestBody,
      sendUpdates: requestBody.attendees && requestBody.attendees.length > 0 ? "all" : "none",
    }),
    GOOGLE_TIMEOUT_MS,
    "Google Calendar patch",
  );

  return extractEventId(response);
}

async function insertGoogleEvent(
  calendar: ReturnType<typeof google.calendar>,
  requestBody: GoogleEventResource,
  venueEventStatus: VenueEventRecord["status"],
): Promise<{ id: string }> {
  const response = await withTimeout(
    calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody,
      sendUpdates: venueEventStatus === "APPROVED" ? "all" : "none",
    }),
    GOOGLE_TIMEOUT_MS,
    "Google Calendar insert",
  );

  return extractEventId(response);
}

async function deleteGoogleEvent(
  calendar: ReturnType<typeof google.calendar>,
  eventId: string,
): Promise<void> {
  await withTimeout(
    calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      sendUpdates: "all",
    }),
    GOOGLE_TIMEOUT_MS,
    "Google Calendar delete",
  );
}

function extractEventId(response: unknown): { id: string } {
  if (!isResponseWithStringId(response)) {
    throw new Error("Google Calendar response did not include a valid event id");
  }

  return { id: response.data.id };
}

function isResponseWithStringId(
  response: unknown,
): response is { data: { id: string } } {
  if (typeof response !== "object" || response === null) {
    return false;
  }

  const responseRecord = response as Record<string, unknown>;
  const data = responseRecord.data;

  if (typeof data !== "object" || data === null) {
    return false;
  }

  const dataRecord = data as Record<string, unknown>;
  return typeof dataRecord.id === "string" && dataRecord.id.length > 0;
}

async function persistSuccessState(
  venueEventId: string,
  gcalEventId: string | null,
  clearGoogleEventId: boolean,
): Promise<void> {
  await prisma.venueEvent.update({
    where: { id: venueEventId },
    data: {
      gcalEventId: clearGoogleEventId ? null : gcalEventId,
      gcalSyncedAt: new Date(),
      gcalSyncError: null,
    },
  });
}

async function persistFailureState(
  venueEventId: string,
  error: string,
): Promise<void> {
  try {
    await prisma.venueEvent.update({
      where: { id: venueEventId },
      data: {
        gcalSyncError: truncateErrorMessage(error),
      },
    });
  } catch (persistErr) {
    logger.error(
      { err: persistErr, venueEventId, originalError: error },
      "Failed to persist Google Calendar sync error",
    );
  }
}

async function clearStoredGoogleEventId(venueEventId: string): Promise<void> {
  await prisma.venueEvent.update({
    where: { id: venueEventId },
    data: {
      gcalEventId: null,
    },
  });
}

function getUtcDateParts(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatWallClockDateTime(
  dateParts: { year: number; month: number; day: number },
  minutesFromMidnight: number,
): string {
  const wallClock = new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, minutesFromMidnight, 0, 0),
  );

  return [
    `${wallClock.getUTCFullYear()}-${pad2(wallClock.getUTCMonth() + 1)}-${pad2(wallClock.getUTCDate())}`,
    `${pad2(wallClock.getUTCHours())}:${pad2(wallClock.getUTCMinutes())}:00`,
  ].join("T");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getGoogleStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const errorRecord = error as Record<string, unknown>;

  if (typeof errorRecord.code === "number") {
    return errorRecord.code;
  }

  if (typeof errorRecord.status === "number") {
    return errorRecord.status;
  }

  const response = errorRecord.response;
  if (typeof response !== "object" || response === null) {
    return null;
  }

  const responseRecord = response as Record<string, unknown>;
  return typeof responseRecord.status === "number" ? responseRecord.status : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown Google Calendar sync error";
  }
}

function truncateErrorMessage(error: string): string {
  return error.length > 500 ? `${error.slice(0, 497)}...` : error;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
