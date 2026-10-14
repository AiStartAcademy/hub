import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { provisionSeriesZoom, syncSeriesOccurrences } from "@/lib/sessionSeries";

/**
 * Provision the series' recurring Zoom meeting, then pull its occurrences in.
 *
 * Kept out of create/update on purpose: this mints a real recurring meeting on the
 * single shared Zoom host account, so it is an explicit, separate action rather
 * than a side effect of saving a form with a typo in it.
 *
 * Re-provisioning a series that already has a meeting is refused — it would orphan
 * the live one (students may already hold the link) without deleting it. Delete the
 * old meeting first via zoom_meeting_delete.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { id } = await params;

    const series = await prisma.sessionSeries.findUnique({
      where: { id },
      select: { id: true, zoomMeetingId: true },
    });
    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });
    if (series.zoomMeetingId) {
      return NextResponse.json(
        { error: "This series already has a Zoom meeting. Delete it before re-provisioning." },
        { status: 409 }
      );
    }

    const meeting = await provisionSeriesZoom(id);
    const synced = await syncSeriesOccurrences(id);

    return NextResponse.json({ success: true, joinUrl: meeting.joinUrl, synced });
  } catch (error) {
    logger.error({ err: error }, "[SESSION_SERIES_ZOOM_POST]");
    // Zoom's own refusals (occurrence cap, bad recurrence) carry a message worth
    // surfacing to the admin — they say exactly which field to change.
    return NextResponse.json({ error: (error as Error).message ?? "Provisioning failed" }, { status: 502 });
  }
}

/** Re-pull occurrences from an already-provisioned Zoom meeting. */
export async function PUT(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { id } = await params;

    const synced = await syncSeriesOccurrences(id);
    if (synced === null) {
      return NextResponse.json({ error: "Series has no usable Zoom meeting yet" }, { status: 409 });
    }

    return NextResponse.json({ success: true, synced });
  } catch (error) {
    logger.error({ err: error }, "[SESSION_SERIES_ZOOM_PUT]");
    return NextResponse.json({ error: (error as Error).message ?? "Sync failed" }, { status: 502 });
  }
}
