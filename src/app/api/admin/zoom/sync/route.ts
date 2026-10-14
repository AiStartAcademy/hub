import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { syncCohortSessions } from "@/lib/zoom";
import { logger } from "@/lib/logger";

/** Sweeps every active cohort with a Zoom link. Per-cohort sync lives at
 *  POST /api/cohorts/[id]/sessions/sync and shares the same implementation. */
export async function POST() {
  try {
    const session = await auth();
    const userRole = (session?.user as any)?.role;

    if (!session || userRole === "STUDENT") {
      console.warn("[Zoom Sync] Unauthorized sync attempt");
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const cohorts = await prisma.cohort.findMany({
      where: {
        zoomLink: { not: null },
        status: { in: ["ENROLLMENT", "IN_PROGRESS", "DRAFT"] },
      },
    });

    logger.info(`[Zoom Sync] Found ${cohorts.length} active cohorts with Zoom links`);
    let syncedOccurrencesCount = 0;

    for (const cohort of cohorts) {
      const synced = await syncCohortSessions(cohort);
      if (synced) syncedOccurrencesCount += synced;
    }

    logger.info(`[Zoom Sync] Sync completed. Processed ${syncedOccurrencesCount} total sessions and matching recordings.`);

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${syncedOccurrencesCount} zoom sessions.`,
    });
  } catch (error) {
    logger.error({ err: error }, "[Zoom Sync] Error during zoom sync:");
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
