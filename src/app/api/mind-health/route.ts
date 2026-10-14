import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readJsonFromGCS, listMindHealthDates } from "@/lib/gcs";
import type { MindHealthData, MindHealthResponse, MindHealthUserRole } from "@/types/mind-health";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

/**
 * GET /api/mind-health?date=2026-06-09
 *
 * - GUEST / STUDENT / TEAM_MEMBER: only sees the "current" date (set by admin).
 *   If no config row exists, shows the latest available date.
 * - INSTRUCTOR / ADMIN: can request any date via ?date= param. Sees full
 *   availableDates list for the calendar.
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  const role: MindHealthUserRole = session
  ? ((session.user as { role?: string }).role ?? "STUDENT") as MindHealthUserRole
  : "GUEST";

  const isPrivileged = hasAnyRole(session?.user, ["INSTRUCTOR", "ADMIN"]);

  // Load available dates
  const availableDates = await listMindHealthDates();

  if (availableDates.length === 0) {
    const response: MindHealthResponse = {
      data: null,
      availableDates: [],
      currentDate: "",
      role,
      canManage: isPrivileged,
    };
    return NextResponse.json(response);
  }

  // Determine which date to serve
  let targetDate: string;
  const requestedDate = request.nextUrl.searchParams.get("date");

  if (isPrivileged && requestedDate) {
    // Privileged users can pick any date
    targetDate = availableDates.includes(requestedDate)
      ? requestedDate
      : availableDates[0];
  } else {
    // Non-privileged: serve the configured "current" date
    const config = await prisma.mindHealthConfig.findUnique({ where: { id: 1 } });
    targetDate = config?.currentDate ?? availableDates[0];
  }

  logger.info(`[MindHealth] Serving date=${targetDate} for role=${role}`);

  const data = await readJsonFromGCS<MindHealthData>(`mind-health/${targetDate}.json`);

  const response: MindHealthResponse = {
    data,
    availableDates: isPrivileged ? availableDates : [],
    currentDate: targetDate,
    role,
    canManage: isPrivileged,
  };

  return NextResponse.json(response);
}