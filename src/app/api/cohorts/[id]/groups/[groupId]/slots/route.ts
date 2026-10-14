import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// GET /api/cohorts/[id]/groups/[groupId]/slots
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;

    const slots = await prisma.instructorSlot.findMany({
      where: { groupId },
      include: {
        instructor: {
          select: { id: true, name: true, email: true, image: true },
        },
        booking: {
          select: {
            id: true,
            status: true,
            studentId: true,
            student: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return NextResponse.json(slots);
  } catch (error) {
    logger.error({ err: error }, "Fetch slots error:");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// POST /api/cohorts/[id]/groups/[groupId]/slots
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: cohortId, groupId } = await params;
    const instructorId = userId;
    const body = await req.json();
    const { date, startTime, endTime, timezone } = body;

    if (!date || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Date, startTime, and endTime are required" },
        { status: 400 }
      );
    }

    // Verify group exists and belongs to the cohort
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { cohort: { include: { instructors: { select: { id: true } } } } },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (group.cohortId !== cohortId) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Check if instructor is assigned to this cohort
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      const isAssigned = group.cohort.instructors.some(inst => inst.id === userId);
      if (!isAssigned) {
        return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
      }
    }

    if (!group.allowOneOnOne) {
      return NextResponse.json(
        { error: "One-on-one sessions are not enabled for this group" },
        { status: 400 }
      );
    }

    const slot = await prisma.instructorSlot.create({
      data: {
        groupId,
        instructorId,
        date: new Date(date),
        startTime,
        endTime,
        timezone: timezone || "UTC",
        isBooked: false,
      },
      include: {
        instructor: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    return NextResponse.json(slot, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "Create slot error:");
    return NextResponse.json(
      { error: "Failed to create slot" },
      { status: 500 }
    );
  }
}
