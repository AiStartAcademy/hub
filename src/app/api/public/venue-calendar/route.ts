import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parseProjectTimeToMinutes } from "@/lib/calendarUtils";
import { SESSION_TZ_FALLBACK } from "@/lib/sessionTime";
import { expandAcrossDays, getMonthRange, overlapsMonth } from "@/lib/venueCalendarRange";

export const dynamic = "force-dynamic";

const PUBLIC_COHORT_STATUSES = ["ENROLLMENT", "IN_PROGRESS", "COMPLETE"] as const;
const CACHE_CONTROL = "s-maxage=300, stale-while-revalidate=600";

/**
 * Venue events store "7:00 PM"; cohort sessions store a UTC ISO string (see
 * src/lib/sessionTime.ts). Sorting must never throw on either — a single
 * unparseable row used to 500 the whole public calendar.
 */
function toSortableMinutes(timeString: string): number {
  try {
    return parseProjectTimeToMinutes(timeString);
  } catch {
    const parsed = new Date(timeString);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getUTCHours() * 60 + parsed.getUTCMinutes();
    }
    return Number.MAX_SAFE_INTEGER; // unknown formats sort last, never crash
  }
}

function sortByDateAndTime<T extends { date: Date; startTime: string }>(items: T[]) {
  return items.sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return toSortableMinutes(a.startTime) - toSortableMinutes(b.startTime);
  });
}

/** Renders a session's ISO timestamp as "7:00 PM" in the zone it's run in. */
function formatSessionTime(value: string | null, timezone: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const build = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: zone,
    }).format(parsed);

  try {
    return build(timezone || SESSION_TZ_FALLBACK);
  } catch {
    return build(SESSION_TZ_FALLBACK); // Intl throws RangeError on unknown zones
  }
}

export async function GET(req: Request) {
  const range = getMonthRange(new URL(req.url).searchParams.get("month"));
  if (!range) {
    return NextResponse.json(
      { error: "Invalid month. Use YYYY-MM." },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } }
    );
  }

  try {
    const [busyRows, approvedEvents, tentativeRows] = await Promise.all([
      prisma.cohortSession.findMany({
        where: {
          date: {
            gte: range.monthStart,
            lt: range.nextMonthStart,
          },
          cohort: {
            status: {
              in: [...PUBLIC_COHORT_STATUSES],
            },
          },
        },
        select: {
          date: true,
          startTime: true,
          endTime: true,
          timezone: true,
          title: true,
          cohort: {
            select: {
              title: true,
            },
          },
        },
      }),
      prisma.venueEvent.findMany({
        // A multi-day event overlapping the month must be picked up even when
        // it starts in the previous month — hence the range test on both ends
        // rather than a plain `date` window.
        where: {
          status: "APPROVED",
          ...overlapsMonth(range),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          type: true,
          date: true,
          endDate: true,
          startTime: true,
          endTime: true,
          orgName: true,
          cover: true,
          ticketPriceCents: true,
        },
      }),
      prisma.venueEvent.findMany({
        where: {
          status: "PENDING",
          ...overlapsMonth(range),
        },
        select: {
          date: true,
          endDate: true,
          startTime: true,
          endTime: true,
        },
      }),
    ]);

    const busy = sortByDateAndTime(
      busyRows.map((session) => ({
        date: session.date,
        // Sessions arrive as UTC ISO strings — normalize to the same "7:00 PM"
        // display format venue events already use.
        startTime: formatSessionTime(session.startTime, session.timezone),
        endTime: formatSessionTime(session.endTime, session.timezone),
        title: session.title,
        cohortTitle: session.cohort.title,
      }))
    );

    const events = sortByDateAndTime(expandAcrossDays(approvedEvents, range));

    const tentative = sortByDateAndTime(
      expandAcrossDays(tentativeRows, range).map((event) => ({
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        label: "Tentative hold" as const,
      }))
    );

    return NextResponse.json(
      { busy, events, tentative },
      { headers: { "Cache-Control": CACHE_CONTROL } }
    );
  } catch (error) {
    logger.error({ err: error }, "[public venue-calendar] failed to load calendar:");
    return NextResponse.json(
      { error: "Unable to load venue calendar." },
      { status: 500, headers: { "Cache-Control": CACHE_CONTROL } }
    );
  }
}
