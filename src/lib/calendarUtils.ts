export const MONTHS: string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const DAYS: string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface CalendarMonthGrid {
  year: number;
  month: number;
  firstDay: number;
  daysInMonth: number;
  daysInPrevMonth: number;
  monthStart: Date;
  monthEnd: Date;
  days: number[];
}

export interface HasStartTime {
  startTime: string;
}

const PROJECT_TIME_PATTERN = /^(\d{1,2}):(\d{2})\s(AM|PM)$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function getCalendarMonthGrid(currentDate: Date): CalendarMonthGrid {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const days: number[] = [];

  for (let i = firstDay - 1; i >= 0; i -= 1) {
    days.push(-(daysInPrevMonth - i));
  }

  for (let i = 1; i <= daysInMonth; i += 1) {
    days.push(i);
  }

  const remainingDays = 42 - days.length;
  for (let i = 1; i <= remainingDays; i += 1) {
    days.push(-(i + 100));
  }

  return {
    year,
    month,
    firstDay,
    daysInMonth,
    daysInPrevMonth,
    monthStart,
    monthEnd,
    days,
  };
}

export function formatLocalTime(timeString: string): string {
  if (timeString.includes("T") && timeString.includes("Z")) {
    const date = new Date(timeString);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }

  return timeString;
}

export function buildDateKeyFromUtcIso(isoString: string): string {
  const date: Date = new Date(isoString);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function normalizeToLocalDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isSameLocalDate(left: Date, right: Date): boolean {
  return normalizeToLocalDate(left).getTime() === normalizeToLocalDate(right).getTime();
}

export function isDateWithinInclusiveRange(
  date: Date,
  startDate: Date,
  endDate: Date | null
): boolean {
  const dateOnly = normalizeToLocalDate(date);
  const startDateOnly = normalizeToLocalDate(startDate);
  const endDateOnly = endDate ? normalizeToLocalDate(endDate) : null;
  const isAfterStart = dateOnly >= startDateOnly;
  const isBeforeEnd = !endDateOnly || dateOnly <= endDateOnly;

  return isAfterStart && isBeforeEnd;
}

export function compareStartTimes<T extends HasStartTime>(left: T, right: T): number {
  const timeA = new Date(left.startTime).getTime();
  const timeB = new Date(right.startTime).getTime();

  if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
    return timeA - timeB;
  }

  return left.startTime.localeCompare(right.startTime);
}

export function parseProjectTimeToMinutes(timeString: string): number {
  const match = PROJECT_TIME_PATTERN.exec(timeString.trim());

  if (!match) {
    throw new Error(`Invalid project time string: ${timeString}`);
  }

  const [, rawHour, rawMinutes, meridiem] = match;
  const parsedHour = Number.parseInt(rawHour, 10);
  const parsedMinutes = Number.parseInt(rawMinutes, 10);

  if (parsedHour < 1 || parsedHour > 12 || parsedMinutes < 0 || parsedMinutes > 59) {
    throw new Error(`Invalid project time string: ${timeString}`);
  }

  const normalizedHour = parsedHour % 12;
  const hourOffset = meridiem === "PM" ? 12 * 60 : 0;

  return normalizedHour * 60 + parsedMinutes + hourOffset;
}

export function timeRangesOverlap(
  startMinutesA: number,
  endMinutesA: number,
  startMinutesB: number,
  endMinutesB: number
): boolean {
  return startMinutesA < endMinutesB && startMinutesB < endMinutesA;
}

/**
 * Overlap check for the project's 12-hour time strings ("6:00 PM").
 *
 * Legacy/imported rows can carry times this project's format never produced, and
 * `parseProjectTimeToMinutes` throws on those. A conflict warning is advisory only —
 * an unparseable stored time means we cannot claim an overlap, so we report `false`
 * rather than failing the caller's request.
 */
export function projectTimeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  try {
    return timeRangesOverlap(
      parseProjectTimeToMinutes(startA),
      parseProjectTimeToMinutes(endA),
      parseProjectTimeToMinutes(startB),
      parseProjectTimeToMinutes(endB)
    );
  } catch {
    return false;
  }
}
