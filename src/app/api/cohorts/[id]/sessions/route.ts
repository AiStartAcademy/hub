import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

interface AuthoredSessionBody {
  title?: unknown;
  description?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  timezone?: unknown;
  meetingLink?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id: cohortId } = await params;
    const body = (await req.json()) as AuthoredSessionBody;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (typeof body.date !== "string" || !body.date.trim()) {
      return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
    }
    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
    }

    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      select: { id: true, startTime: true, endTime: true, timezone: true },
    });
    if (!cohort) {
      return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    }

    const authoredSession = await prisma.cohortSession.create({
      data: {
        cohortId,
        title,
        description:
          typeof body.description === "string"
            ? body.description.trim() || null
            : null,
        date,
        startTime:
          typeof body.startTime === "string"
            ? body.startTime.trim()
            : cohort.startTime ?? "",
        endTime:
          typeof body.endTime === "string"
            ? body.endTime.trim()
            : cohort.endTime ?? "",
        timezone:
          typeof body.timezone === "string" && body.timezone.trim()
            ? body.timezone.trim()
            : cohort.timezone,
        meetingLink:
          typeof body.meetingLink === "string"
            ? body.meetingLink.trim() || null
            : null,
        zoomOccurrenceId: null,
      },
    });

    return NextResponse.json(authoredSession, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "[COHORT_SESSION_POST]");
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
