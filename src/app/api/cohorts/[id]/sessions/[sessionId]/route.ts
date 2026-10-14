import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { isHttpUrl, propagateRecordingLink, resolveJoinLink } from "@/lib/sessionLink";

type SessionPatch = {
  title?: string;
  description?: string | null;
  recordingLink?: string | null;
  meetingLink?: string | null;
  linkedSessionId?: string | null;
};

/**
 * Quick-edit one session from the cohort edit page.
 *
 * Only the fields Zoom does NOT own are editable: title, description,
 * recordingLink, and the join link. Date/time/status/order come from Zoom on
 * every sync and would be silently overwritten, so they are deliberately not
 * accepted here.
 *
 * The join link comes in one of two mutually exclusive shapes:
 *   { meetingLink: "https://…" | null }  — a custom link (null clears back to
 *                                          the cohort link); drops provenance.
 *   { linkedSessionId }                  — borrow another session's link. The
 *                                          URL is resolved server-side and
 *                                          copied into meetingLink, so the
 *                                          client never handles another
 *                                          cohort's link.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id: cohortParam, sessionId } = await params;
    // The edit page lives at the slug URL, so accept a slug or a cuid — the
    // tenant guard below needs the real id or every PATCH from /cohorts/<slug>/edit 404s.
    const cohortRow = await prisma.cohort.findFirst({
      where: { OR: [{ id: cohortParam }, { slug: cohortParam }] },
      select: { id: true },
    });
    if (!cohortRow) return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    const cohortId = cohortRow.id;
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const data: SessionPatch = {};
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
      data.title = title;
    }
    if (typeof body.description === "string") data.description = body.description.trim() || null;
    if (typeof body.recordingLink === "string") data.recordingLink = body.recordingLink.trim() || null;

    const hasMeetingLink = Object.prototype.hasOwnProperty.call(body, "meetingLink");
    const hasLinkedSession = body.linkedSessionId !== undefined;
    if (hasMeetingLink && hasLinkedSession) {
      return NextResponse.json(
        { error: "Set either a custom meeting link or a linked session, not both" },
        { status: 400 }
      );
    }

    if (hasMeetingLink) {
      if (body.meetingLink === null) {
        data.meetingLink = null;
      } else if (isHttpUrl(body.meetingLink)) {
        data.meetingLink = (body.meetingLink as string).trim();
      } else {
        return NextResponse.json(
          { error: "Meeting link must be an http(s) URL" },
          { status: 400 }
        );
      }
      // A hand-set (or cleared) link is no longer borrowed from anywhere.
      data.linkedSessionId = null;
    }

    if (hasLinkedSession) {
      const linkedSessionId =
        typeof body.linkedSessionId === "string" ? body.linkedSessionId.trim() : "";
      if (!linkedSessionId) {
        return NextResponse.json({ error: "linkedSessionId must be a session id" }, { status: 400 });
      }
      if (linkedSessionId === sessionId) {
        return NextResponse.json({ error: "A session cannot link to itself" }, { status: 400 });
      }
      const source = await prisma.cohortSession.findUnique({
        where: { id: linkedSessionId },
        select: { id: true, meetingLink: true, cohort: { select: { zoomLink: true } } },
      });
      if (!source) {
        return NextResponse.json({ error: "Linked session not found" }, { status: 404 });
      }
      const link = resolveJoinLink(source);
      if (!link) {
        return NextResponse.json(
          { error: "The linked session has no join link to borrow" },
          { status: 400 }
        );
      }
      data.meetingLink = link;
      data.linkedSessionId = source.id;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // cohortId in the where clause keeps one cohort from editing another's rows.
    const result = await prisma.cohortSession.updateMany({ where: { id: sessionId, cohortId }, data });
    if (result.count === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // A recording attached here reaches every session that borrowed this one's
    // meeting, the same way the Zoom sync's recordings do.
    if (data.recordingLink) {
      await propagateRecordingLink(sessionId, data.recordingLink);
    }

    const updated = await prisma.cohortSession.findUnique({
      where: { id: sessionId },
      // The source cohort title rides along so the admin panel can label a
      // borrowed link without fetching every other cohort.
      include: { linkedSession: { select: { cohort: { select: { id: true, title: true } } } } },
    });
    return NextResponse.json({ success: true, session: updated });
  } catch (error) {
    logger.error({ err: error }, "[COHORT_SESSION_PATCH]");
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}
