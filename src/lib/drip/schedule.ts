// src/lib/drip/schedule.ts
// Send-window arithmetic for drip campaigns.
//
// A step becomes *due* at `previousSend + delayHours`. Being due is not the same
// as being sendable: campaigns declare a local send window (and optionally skip
// weekends) so nurture mail lands during business hours in the campaign's own
// timezone. A step due outside the window is deferred to the next open slot —
// never dropped, and never sent early.

import { isValidIanaTimezone } from "@/lib/timezone";

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

export type SendWindow = {
  timezone: string;
  /** Inclusive local hour the window opens, 0-23. */
  startHour: number;
  /** Exclusive local hour the window closes, 1-24. */
  endHour: number;
  skipWeekends: boolean;
};

export function normalizeWindow(input: {
  timezone?: string | null;
  sendWindowStartHour?: number | null;
  sendWindowEndHour?: number | null;
  skipWeekends?: boolean | null;
}): SendWindow {
  const timezone =
    input.timezone && isValidIanaTimezone(input.timezone)
      ? input.timezone
      : DEFAULT_TIMEZONE;

  const rawStart = clampHour(input.sendWindowStartHour, 8, 0, 23);
  const rawEnd = clampHour(input.sendWindowEndHour, 18, 1, 24);
  // An inverted or empty window would deadlock the sweep — fall back to all-day.
  const valid = rawEnd > rawStart;

  return {
    timezone,
    startHour: valid ? rawStart : 0,
    endHour: valid ? rawEnd : 24,
    skipWeekends: Boolean(input.skipWeekends),
  };
}

function clampHour(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

type LocalParts = { hour: number; weekday: number };

/** Local hour (0-23) and weekday (0=Sun … 6=Sat) of `at` in `timezone`. */
export function localParts(at: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(at);

  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const weekdayPart = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    // Intl can emit "24" for midnight under hour12:false in some runtimes.
    hour: Number(hourPart) % 24,
    weekday: Math.max(0, weekdays.indexOf(weekdayPart)),
  };
}

export function isWithinWindow(at: Date, window: SendWindow): boolean {
  const { hour, weekday } = localParts(at, window.timezone);
  if (window.skipWeekends && (weekday === 0 || weekday === 6)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * The first instant at or after `at` that falls inside the window.
 *
 * Walks forward in one-hour steps rather than doing calendar math: DST shifts and
 * timezone offsets are handled by `localParts` instead of being re-derived here.
 * Bounded to 14 days so a pathological window can never spin.
 */
export function nextWindowOpening(at: Date, window: SendWindow): Date {
  if (isWithinWindow(at, window)) return at;

  const cursor = new Date(at.getTime());
  // Snap to the top of the hour so successive deferrals converge on window open.
  cursor.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 14; i += 1) {
    cursor.setTime(cursor.getTime() + 3_600_000);
    if (isWithinWindow(cursor, window)) return cursor;
  }
  return at; // Unreachable for a normalized window; fail open rather than stall.
}

/** When a step scheduled `delayHours` after `from` should actually go out. */
export function scheduleStep(
  from: Date,
  delayHours: number,
  window: SendWindow
): Date {
  const hours = Number.isFinite(delayHours) ? Math.max(0, delayHours) : 0;
  const due = new Date(from.getTime() + hours * 3_600_000);
  return nextWindowOpening(due, window);
}

// ── Voice-call clamp ──────────────────────────────────────────────────
// Automated calls are held to a stricter envelope than mail regardless of how
// permissive the campaign's own window is: 10:00–18:00 campaign-local,
// weekdays only. (TCPA's outer bound is 8:00–21:00 lead-local; since we only
// know the campaign timezone, we clamp well inside it.)

export const CALL_WINDOW_START_HOUR = 10;
export const CALL_WINDOW_END_HOUR = 18;
export const SMS_WINDOW_START_HOUR = 9;
export const SMS_WINDOW_END_HOUR = 20;

/** Intersect a campaign window with a fixed hourly envelope. */
export function clampWindowTo(
  window: SendWindow,
  startHour: number,
  endHour: number
): SendWindow {
  const clampedStartHour = Math.max(window.startHour, startHour);
  const clampedEndHour = Math.min(window.endHour, endHour);
  const valid = clampedEndHour > clampedStartHour;
  return {
    timezone: window.timezone,
    startHour: valid ? clampedStartHour : startHour,
    endHour: valid ? clampedEndHour : endHour,
    skipWeekends: window.skipWeekends,
  };
}

/** Intersect a campaign window with the fixed call envelope. */
export function clampWindowForCalls(window: SendWindow): SendWindow {
  const clamped = clampWindowTo(window, CALL_WINDOW_START_HOUR, CALL_WINDOW_END_HOUR);
  return {
    ...clamped,
    skipWeekends: true,
  };
}

/** Intersect a campaign window with the fixed SMS envelope. */
export function clampWindowForSms(window: SendWindow): SendWindow {
  return clampWindowTo(window, SMS_WINDOW_START_HOUR, SMS_WINDOW_END_HOUR);
}

export function describeWindow(window: SendWindow): string {
  const fmt = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  const days = window.skipWeekends ? "Mon–Fri" : "daily";
  if (window.startHour === 0 && window.endHour === 24) {
    return `Any time, ${days} (${window.timezone})`;
  }
  return `${fmt(window.startHour)}–${fmt(window.endHour)} ${days} (${window.timezone})`;
}
