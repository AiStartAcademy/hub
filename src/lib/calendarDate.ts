/**
 * Helpers for *date-only* values (cohort startDate/endDate).
 *
 * These are calendar dates, not instants. They are written as `new Date("2026-08-10")`,
 * i.e. anchored at UTC midnight, and must be read back with UTC getters. Using local
 * getters shifts them a day earlier for any viewer west of UTC (Pacific time reads
 * 2026-08-10T00:00:00Z as Aug 9, 17:00).
 *
 * Compare them as `YYYY-MM-DD` strings — that sorts lexicographically and never
 * involves a timezone. Do NOT use these for timestamped events (group / 1-on-1
 * sessions): those are real instants and should be rendered in the viewer's local
 * time, see `sessionTime.ts`.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC-anchored `YYYY-MM-DD` for a date-only value. Null-safe. */
export function toCalendarDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` from calendar-grid coordinates. `month` is 0-indexed, as in `Date`. */
export function calendarDateFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}
