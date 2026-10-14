// src/lib/sessionInstant.ts
//
// One place that turns a CohortSession row into an absolute UTC interval.
//
// Session times exist in two shapes in the same column, for historical reasons:
//   1. Zoom-synced rows (src/lib/zoom.ts syncCohortSessions) store a full UTC ISO
//      string in startTime/endTime and a real IANA zone in timezone.
//   2. Hand-created rows store 12-hour wall-clock ("10:00 AM") plus an abbreviation
//      ("PST"), with the calendar day living in `date`.
// Everything that needs to compare sessions across cohorts (conflict detection,
// reminders, Google Calendar) needs a single absolute instant, so it goes through here.

import { parseProjectTimeToMinutes } from "@/lib/calendarUtils";
import { SESSION_TZ_FALLBACK } from "@/lib/sessionTime";
import { logger } from "@/lib/logger";

export type SessionTimeInput = {
  date: Date;
  startTime: string;
  endTime: string;
  timezone: string | null;
};

export type SessionInterval = {
  startUtc: Date;
  endUtc: Date;
  /** IANA zone the session is actually run in — what Google Calendar wants for display. */
  ianaTz: string;
  /** Which stored shape this row used; useful in tests and diagnostics. */
  shape: "iso" | "wall-clock";
};

/** Abbreviations the hand-created rows use. Anything else falls back to SF. */
const ABBREV_TO_IANA: Record<string, string> = {
  PT: "America/Los_Angeles",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MT: "America/Denver",
  MST: "America/Denver",
  MDT: "America/Denver",
  CT: "America/Chicago",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  ET: "America/New_York",
  EST: "America/New_York",
  EDT: "America/New_York",
  UTC: "UTC",
  GMT: "UTC",
};

export function resolveIanaZone(timezone: string | null | undefined): string {
  const raw = (timezone ?? "").trim();
  if (!raw) return SESSION_TZ_FALLBACK;
  if (raw.includes("/")) return raw; // already IANA
  const mapped = ABBREV_TO_IANA[raw.toUpperCase()];
  if (mapped) return mapped;
  logger.warn({ timezone: raw }, "[sessionInstant] unknown timezone, falling back");
  return SESSION_TZ_FALLBACK;
}

/**
 * Offset (in minutes) of `zone` from UTC at the given instant — DST-correct because
 * it asks Intl what the wall clock reads there. Avoids pulling in date-fns-tz.
 */
function zoneOffsetMinutes(instant: Date, zone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Hour 24 appears in some ICU builds for midnight; normalize it.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60000;
}

/**
 * Absolute instant for a wall-clock time in a zone. Two passes because the offset
 * itself depends on the instant (DST boundaries): guess with the first offset, then
 * re-resolve at the guessed instant.
 */
export function wallClockToUtc(year: number, month: number, day: number, minutes: number, zone: string): Date {
  const naiveUtc = Date.UTC(year, month, day, Math.floor(minutes / 60), minutes % 60);
  const firstOffset = zoneOffsetMinutes(new Date(naiveUtc), zone);
  const guess = new Date(naiveUtc - firstOffset * 60000);
  const secondOffset = zoneOffsetMinutes(guess, zone);
  if (secondOffset === firstOffset) return guess;
  return new Date(naiveUtc - secondOffset * 60000);
}

/**
 * Normalize a session row to an absolute UTC interval, or null if the stored times
 * can't be parsed (legacy/imported rows). Callers treat null as "cannot reason about
 * this session's time" — never as an error.
 */
export function sessionInterval(session: SessionTimeInput): SessionInterval | null {
  const ianaTz = resolveIanaZone(session.timezone);

  // Shape 1: full ISO instants written by the Zoom sync.
  const isoStart = new Date(session.startTime);
  const isoEnd = new Date(session.endTime);
  if (
    session.startTime.includes("T") &&
    !Number.isNaN(isoStart.getTime()) &&
    !Number.isNaN(isoEnd.getTime())
  ) {
    const endUtc = isoEnd.getTime() > isoStart.getTime() ? isoEnd : new Date(isoStart.getTime() + 60 * 60000);
    return { startUtc: isoStart, endUtc, ianaTz, shape: "iso" };
  }

  // Shape 2: 12-hour wall clock against the session's calendar day.
  let startMinutes: number;
  let endMinutes: number;
  try {
    startMinutes = parseProjectTimeToMinutes(session.startTime);
    endMinutes = parseProjectTimeToMinutes(session.endTime);
  } catch {
    return null;
  }
  // `date` is stored as a UTC midnight-ish timestamp; read its calendar parts in UTC
  // so a session dated Aug 17 doesn't drift to Aug 16 for western viewers.
  const d = session.date;
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  const startUtc = wallClockToUtc(year, month, day, startMinutes, ianaTz);
  // An end before the start means the session runs past midnight — or the data is
  // junk. Mirror googleCalendar's venue behaviour: fall back to a one-hour block.
  const endUtc =
    endMinutes > startMinutes
      ? wallClockToUtc(year, month, day, endMinutes, ianaTz)
      : new Date(startUtc.getTime() + 60 * 60000);

  return { startUtc, endUtc, ianaTz, shape: "wall-clock" };
}

export function intervalsOverlap(
  a: { startUtc: Date; endUtc: Date },
  b: { startUtc: Date; endUtc: Date }
): boolean {
  return a.startUtc.getTime() < b.endUtc.getTime() && b.startUtc.getTime() < a.endUtc.getTime();
}

/** Calendar day (YYYY-MM-DD) the session falls on in its own zone — for day grouping. */
export function localDateKey(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Minute-of-day in the session's own zone — used for day/evening classification. */
export function localMinuteOfDay(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return (get("hour") % 24) * 60 + get("minute");
}
