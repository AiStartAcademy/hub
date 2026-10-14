import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { syncCohortSessions } from "@/lib/zoom";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { parseSyncRecordingsBody } from "@/lib/zoomRecordingsUrl";


/** Pulls this one cohort's schedule from Zoom, then returns the fresh rows. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id: cohortId } = await params;
    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: { id: true, title: true, zoomLink: true, rawProgramId: true },
    });
    if (!cohort) {
      return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    }
    if (!cohort.zoomLink) {
      return NextResponse.json({ error: "This cohort has no Zoom link to sync from." }, { status: 400 });
    }

    // Optional body { zoomInstanceUuid } imports that past meeting instance's recording
    // instead of only the latest one. No body = unchanged behavior.
    const body = parseSyncRecordingsBody(await req.text());
    if (!body.ok) {
      return NextResponse.json({ error: body.error }, { status: body.status });
    }
    if (body.zoomInstanceUuid && !cohort.rawProgramId) {
      return NextResponse.json(
        { error: "This cohort has no raw recordings program. Set rawProgramId on the cohort first." },
        { status: 400 }
      );
    }

    const synced = await syncCohortSessions(cohort, { zoomInstanceUuid: body.zoomInstanceUuid });
    if (synced === null) {
      return NextResponse.json(
        { error: "Zoom returned no occurrences for this meeting. Check the link is a recurring meeting you own." },
        { status: 422 }
      );
    }

    const sessions = await prisma.cohortSession.findMany({
      where: { cohortId },
      orderBy: { order: "asc" },
    });

    return NextResponse.json({ success: true, synced, sessions });
  } catch (error) {
    logger.error({ err: error }, "[COHORT_SESSIONS_SYNC]");
    return NextResponse.json({ error: "Failed to sync from Zoom" }, { status: 500 });
  }
}
