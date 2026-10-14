import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireManagedServiceToken } from "@/lib/serviceAuth";
import { mcpWritesEnabled } from "@/lib/mcpApi";
import { deleteZoomMeeting } from "@/lib/zoom";
import { logger } from "@/lib/logger";

/**
 * Machine-callable Zoom meeting deletion for hub-mcp — cleanup for test/throwaway
 * cohorts created via POST /api/internal/mcp/cohort with createZoomMeeting: true.
 *
 * Deletes the WHOLE recurring series on Zoom (irreversible) and, if the meeting is
 * still linked to a Cohort, clears that Cohort's zoomLink/zoomMeetingId so the DB
 * doesn't keep pointing at a deleted meeting. Does NOT delete the Cohort row itself
 * — cohorts have no delete tool by design (see hub-mcp/work/DECISIONS.md D-010);
 * this only cleans up the external Zoom resource.
 */
export async function POST(req: Request) {
  const denied = await requireManagedServiceToken(req, "HUB_MCP_TOKEN");
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return NextResponse.json(
      { error: "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true')." },
      { status: 403 }
    );
  }

  let body: { zoomMeetingId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const zoomMeetingId = typeof body.zoomMeetingId === "string" ? body.zoomMeetingId.trim() : "";
  if (!zoomMeetingId) {
    return NextResponse.json({ error: "zoomMeetingId is required" }, { status: 400 });
  }

  try {
    await deleteZoomMeeting(zoomMeetingId);

    const cleared = await prisma.cohort.updateMany({
      where: { zoomMeetingId },
      data: { zoomLink: null, zoomMeetingId: null },
    });

    logger.info(`[MCP] Deleted Zoom meeting ${zoomMeetingId} (cleared on ${cleared.count} cohort row(s))`);

    return NextResponse.json({ deleted: true, zoomMeetingId, cohortsCleared: cleared.count });
  } catch (error) {
    logger.error({ err: error }, "[MCP] Zoom meeting delete failed:");
    return NextResponse.json({ error: `Failed to delete Zoom meeting: ${(error as Error).message}` }, { status: 500 });
  }
}
