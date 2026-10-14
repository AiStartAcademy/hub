// src/lib/venueCalendarRange.ts
//
// Month-window helpers shared by the public venue calendar and the staff-only
// pending-holds route. They live here rather than in either route because the
// two must agree exactly on which events fall in a month and how a multi-day
// event is spread across its days — if they drift, a hold and an approved
// event dated the same way would land on different squares of the same grid.

export type MonthRange = { monthStart: Date; nextMonthStart: Date };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses `?month=YYYY-MM` into a UTC half-open window. null = malformed input. */
export function getMonthRange(monthParam: string | null): MonthRange | null {
  if (monthParam !== null && !MONTH_RE.test(monthParam)) {
    return null;
  }

  const now = new Date();
  const year = monthParam ? Number(monthParam.slice(0, 4)) : now.getUTCFullYear();
  const monthIndex = monthParam ? Number(monthParam.slice(5, 7)) - 1 : now.getUTCMonth();

  return {
    monthStart: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)),
    nextMonthStart: new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0)),
  };
}

/**
 * Prisma `where` fragment matching any event whose span touches the month.
 * Single-day rows have `endDate: null`, so they match on `date` alone; a
 * multi-day event starting in the previous month still qualifies.
 */
export function overlapsMonth(range: MonthRange) {
  return {
    AND: [
      { date: { lt: range.nextMonthStart } },
      {
        OR: [{ date: { gte: range.monthStart } }, { endDate: { gte: range.monthStart } }],
      },
    ],
  };
}

/**
 * Expands a multi-day event into one entry per calendar day it occupies, each
 * clipped to the requested month. Without this a two-day workshop only appears
 * on its first day and the grid shows nothing on the second.
 */
export function expandAcrossDays<T extends { date: Date; endDate: Date | null }>(
  rows: T[],
  range: MonthRange
): Array<Omit<T, "endDate"> & { date: Date; dayIndex: number; dayCount: number }> {
  return rows.flatMap(({ endDate, ...rest }) => {
    const start = (rest as { date: Date }).date;
    const last = endDate && endDate.getTime() > start.getTime() ? endDate : start;
    const dayCount = Math.floor((last.getTime() - start.getTime()) / DAY_MS) + 1;

    const days: Array<Omit<T, "endDate"> & { date: Date; dayIndex: number; dayCount: number }> = [];
    for (let index = 0; index < dayCount; index += 1) {
      const date = new Date(start.getTime() + index * DAY_MS);
      if (date < range.monthStart || date >= range.nextMonthStart) continue;
      days.push({ ...(rest as Omit<T, "endDate">), date, dayIndex: index, dayCount });
    }
    return days;
  });
}
