import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getVisibleSeriesOccurrences } from "@/lib/seriesSchedule";
import { resolveJoinLink } from "@/lib/sessionLink";

export async function GET() {
  try {
    const session = await auth();
    const sessionUser = session?.user as { id?: string; role?: string } | undefined;
    const userId = sessionUser?.id;
    const userRole = sessionUser?.role;

    if (!session || !userId) {
      console.warn("[CohortSessions API] Unauthorized access attempt");
      return new NextResponse("Unauthorized", { status: 401 });
    }

    let sessions = [];

    if (userRole === "STUDENT") {
      // Find the programs the student belongs to
      const enrollments = await prisma.enrollment.findMany({
        where: { userId },
        select: { cohortId: true }
      });
      const cohortIds = enrollments.map(e => e.cohortId);

      sessions = await prisma.cohortSession.findMany({
        where: { cohortId: { in: cohortIds }, status: { not: "cancelled" } },
        include: { cohort: { select: { title: true, zoomLink: true } } },
        orderBy: { date: "asc" }
      });
    } else {
      // Admins and instructors see all sessions for their role
      sessions = await prisma.cohortSession.findMany({
        where: { status: { not: "cancelled" } },
        include: { cohort: { select: { title: true, zoomLink: true } } },
        orderBy: { date: "asc" }
      });
    }

    // Shared check-in calls live in SeriesOccurrence, not CohortSession (see
    // prisma/schema.prisma "Shared Session Series"), so the calendar has to be handed
    // both streams. They are shaped like cohort sessions here — with the series title
    // standing in for the cohort title — so the client renders them without a special
    // case, and flagged with isSharedSeries for the ones that want to label them.
    const seriesOccurrences = await getVisibleSeriesOccurrences(
      { userId, role: userRole ?? "STUDENT" },
      // No `from` bound: the calendar pages backwards through past months too.
      { from: new Date(0), take: 500 }
    );

    const seriesRows = seriesOccurrences.map((o) => ({
      id: o.id,
      title: o.title,
      description: null,
      timezone: o.timezone,
      date: o.date,
      startTime: o.startTime,
      endTime: o.endTime,
      status: o.status,
      meetingLink: o.meetingLink,
      recordingLink: o.recordingLink,
      cohortId: "",
      cohort: { title: o.context },
      isSharedSeries: true as const,
    }));

    // A session without its own link inherits the cohort-wide one, so
    // MCP-created and hand-made sessions get a Join button too.
    const cohortRows = sessions.map((s) => ({ ...s, meetingLink: resolveJoinLink(s) }));

    return NextResponse.json([...cohortRows, ...seriesRows]);
  } catch (error) {
    logger.error({ err: error }, "[CohortSessions API] Error fetching sessions:");
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}