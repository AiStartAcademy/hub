import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

/**
 * PUT /api/admin/mind-health
 * Body: { date: "2026-06-09" }
 *
 * Only INSTRUCTOR and ADMIN can set the current mind-health date.
 */
export async function PUT(request: NextRequest) {
  const session = await auth();

  if (!session || !hasAnyRole(session?.user, ["INSTRUCTOR", "ADMIN"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { date } = (await request.json()) as { date?: string };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
  }

  // Upsert the singleton config row
  const config = await prisma.mindHealthConfig.upsert({
    where: { id: 1 },
    update: {
      currentDate: date,
      updatedById: (session.user as { id: string }).id,
    },
    create: {
      id: 1,
      currentDate: date,
      updatedById: (session.user as { id: string }).id,
    },
  });

  logger.info(`[MindHealth] Current date set to ${date} by ${session.user.email}`);

  return NextResponse.json({ success: true, config });
}

/**
 * GET /api/admin/mind-health
 * Returns current config + available dates for the management panel.
 */
export async function GET() {
  const session = await auth();

  if (!session || !hasAnyRole(session?.user, ["INSTRUCTOR", "ADMIN"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await prisma.mindHealthConfig.findUnique({ where: { id: 1 } });
  const { listMindHealthDates } = await import("@/lib/gcs");
  const availableDates = await listMindHealthDates();

  return NextResponse.json({ config, availableDates });
}