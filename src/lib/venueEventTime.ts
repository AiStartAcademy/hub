/**
 * One place that turns a VenueEvent row into absolute instants.
 *
 * Venue events store a date-only `date` (UTC midnight), free-text 12-hour
 * `startTime`/`endTime` ("7:00 PM"), and an IANA `timezone`. That shape is fine
 * for display but useless for structured data — the public page's Event JSON-LD
 * was emitting `startDate` as UTC midnight, so the actual start time never
 * reached Google, and there was no `endDate` at all. It's also what .ics needs.
 *
 * Nothing is migrated: this derives the instants on read. The DST-correct
 * wall-clock conversion is shared with cohort sessions via
 * `wallClockToUtc` in src/lib/sessionInstant.ts.
 */

import { parseProjectTimeToMinutes } from "@/lib/calendarUtils";
import { resolveIanaZone, wallClockToUtc } from "@/lib/sessionInstant";

export type VenueEventTimeInput = {
  date: Date;
  endDate?: Date | null;
  // Nullable: some legacy/JSON-LD selects carry these as optional columns.
  // The parser treats null the same as unparseable and falls back.
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
};

export type VenueEventInstants = {
  startUtc: Date;
  endUtc: Date;
  /** IANA zone the event runs in — what Google Calendar and .ics want. */
  ianaTz: string;
  /** Offset-bearing local ISO strings, the form schema.org Event wants. */
  startIsoLocal: string;
  endIsoLocal: string;
  isMultiDay: boolean;
};

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_START_MINUTES = 19 * 60; // 7:00 PM — the venue's usual evening slot

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** parseProjectTimeToMinutes throws on anything it doesn't recognize. */
function minutesOrNull(time: string | null | undefined): number | null {
  if (!time) return null;
  try {
    return parseProjectTimeToMinutes(time);
  } catch {
    return null;
  }
}

function utcDateParts(date: Date): { year: number; month: number; day: number } | null {
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

/**
 * ISO 8601 with the zone's real offset at that instant — e.g.
 * "2026-09-12T11:00:00-07:00". schema.org treats a bare local time as
 * ambiguous and a `Z` time as a different wall clock, so the offset matters.
 */
function toLocalIso(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

  // Hour 24 shows up for midnight in some ICU builds.
  const hour = pad2(Number(get("hour")) % 24);
  const local = `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;

  const asUtc = Date.parse(`${local}Z`);
  const offsetMinutes = Math.round((asUtc - instant.getTime()) / 60000);
  if (offsetMinutes === 0) return `${local}Z`;

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${local}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * Absolute start/end for a venue event. Never returns null and never throws —
 * a public page must still render when the times are junk, so unparseable
 * input degrades to a sane 7 PM / +1h block on the stored calendar day.
 */
export function resolveEventInstants(event: VenueEventTimeInput): VenueEventInstants {
  const ianaTz = resolveIanaZone(event.timezone);

  const startParts = utcDateParts(event.date) ?? utcDateParts(new Date());
  // `!` is safe: the fallback above is always a valid Date.
  const { year, month, day } = startParts!;

  const startMinutes = minutesOrNull(event.startTime) ?? DEFAULT_START_MINUTES;
  const startUtc = wallClockToUtc(year, month, day, startMinutes, ianaTz);

  // A multi-day event ends on `endDate`; a single-day one ends on the same day.
  const endDayParts = event.endDate ? utcDateParts(event.endDate) : null;
  const endDay = endDayParts ?? { year, month, day };
  const isMultiDay = Boolean(
    endDayParts &&
      (endDayParts.year !== year || endDayParts.month !== month || endDayParts.day !== day)
  );

  const endMinutes = minutesOrNull(event.endTime);
  const candidateEnd =
    endMinutes === null
      ? null
      : wallClockToUtc(endDay.year, endDay.month, endDay.day, endMinutes, ianaTz);

  // End at or before start means the row is junk (or a past-midnight event we
  // can't distinguish from junk). Mirror the +1h fallback googleCalendar uses.
  const endUtc =
    candidateEnd && candidateEnd.getTime() > startUtc.getTime()
      ? candidateEnd
      : new Date(startUtc.getTime() + HOUR_MS);

  return {
    startUtc,
    endUtc,
    ianaTz,
    startIsoLocal: toLocalIso(startUtc, ianaTz),
    endIsoLocal: toLocalIso(endUtc, ianaTz),
    isMultiDay,
  };
}

/**
 * Last calendar day the event occupies, as a UTC-midnight Date — the value to
 * compare against "today" when deciding whether an event is over. A two-day
 * workshop is not past on its second morning.
 */
export function eventLastDay(event: { date: Date; endDate?: Date | null }): Date {
  const end = event.endDate;
  if (end && !Number.isNaN(end.getTime()) && end.getTime() > event.date.getTime()) return end;
  return event.date;
}

/** True once the event's final day is behind us (UTC day granularity). */
export function isEventPast(event: { date: Date; endDate?: Date | null }, now = new Date()): boolean {
  const last = eventLastDay(event);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const lastUtc = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  return lastUtc < todayUtc;
}

/**
 * Human date, collapsing a range where it reads better:
 * "Saturday, September 12, 2026" · "September 12–13, 2026" · "Aug 30 – Sep 1, 2026".
 */
export function formatEventDateRange(
  event: { date: Date; endDate?: Date | null },
  options: { style?: "long" | "short" } = {}
): string {
  const long = options.style !== "short";
  const start = event.date;
  const end = eventLastDay(event);

  const fmt = (date: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(date);

  const single: Intl.DateTimeFormatOptions = long
    ? { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };

  if (start.getTime() === end.getTime()) return fmt(start, single);

  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const monthStyle = long ? "long" : "short";

  if (sameMonth) {
    return `${fmt(start, { month: monthStyle, day: "numeric" })}–${fmt(end, { day: "numeric" })}, ${start.getUTCFullYear()}`;
  }

  return `${fmt(start, { month: monthStyle, day: "numeric" })} – ${fmt(end, { month: monthStyle, day: "numeric" })}, ${end.getUTCFullYear()}`;
}
