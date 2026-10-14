// GET /api/venue-calendar/pending?month=YYYY-MM
//
// Staff-only companion to /api/public/venue-calendar. The public route
// deliberately redacts PENDING venue events down to date and time — an
// anonymous "Tentative hold" — so visitors can see the room is busy without
// learning who booked it. Admins and team members need the opposite: which
// booking is holding that slot, so a hold on the dashboard calendar is
// actionable rather than a mystery.
//
// This is a separate endpoint rather than a role branch inside the public one
// on purpose. That route is unauthenticated, reads no cookies, and sends
// `s-maxage=300` with no `Vary: Cookie`; varying its body by role would let any
// shared cache hand staff-only booking names to anonymous visitors. Here the
// response is explicitly `private, no-store` and never cacheable.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { expandAcrossDays, getMonthRange, overlapsMonth } from "@/lib/venueCalendarRange";

export const dynamic = "force-dynamic";

/**
 * Deliberately narrower than MANAGE_ROLES, which also includes INSTRUCTOR.
 * Booking pipeline detail is commercial information: the same pair the venue
 * admin routes already gate on.
 */
const VENUE_STAFF_ROLES = ["ADMIN", "TEAM_MEMBER"] as const;

const NO_STORE = "private, no-store";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!hasAnyRole(session?.user, [...VENUE_STAFF_ROLES])) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": NO_STORE } }
    );
  }

  const range = getMonthRange(new URL(req.url).searchParams.get("month"));
  if (!range) {
    return NextResponse.json(
      { error: "Invalid month. Use YYYY-MM." },
      { status: 400, headers: { "Cache-Control": NO_STORE } }
    );
  }

  try {
    const rows = await prisma.venueEvent.findMany({
      where: { status: "PENDING", ...overlapsMonth(range) },
      select: {
        id: true,
        slug: true,
        title: true,
        orgName: true,
        date: true,
        endDate: true,
        startTime: true,
        endTime: true,
      },
    });

    // Same day-expansion the public route uses, so a multi-day hold lands on
    // every square it occupies rather than only its first day.
    const pending = expandAcrossDays(rows, range).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    return NextResponse.json({ pending }, { headers: { "Cache-Control": NO_STORE } });
  } catch (error) {
    logger.error({ err: error }, "[venue-calendar/pending] failed to load pending holds:");
    return NextResponse.json(
      { error: "Unable to load pending holds." },
      { status: 500, headers: { "Cache-Control": NO_STORE } }
    );
  }
}
