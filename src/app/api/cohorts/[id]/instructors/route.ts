import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { syncCohortInstructors } from "@/lib/instructorParticipation";


// POST /api/cohorts/[id]/instructors
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;
    const body = await req.json();
    let instructorId = body.instructorId;

    // RULE: Instructor can only add themselves
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      instructorId = userId;
    }

    if (!instructorId) {
      return NextResponse.json({ error: "Instructor ID is required" }, { status: 400 });
    }

    // Verify the user being added is an instructor
    const instructorUser = await prisma.user.findUnique({
      where: { id: instructorId },
      select: { role: true, roles: true }
    });

    if (!instructorUser || !hasRole(instructorUser, "INSTRUCTOR")) {
      return NextResponse.json({ error: "User is not an instructor" }, { status: 400 });
    }

    await prisma.cohort.update({
      where: { id },
      data: {
        instructors: {
          connect: { id: instructorId }
        }
      }
    });
    await syncCohortInstructors(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Add instructor error:");
    return NextResponse.json({ error: "Failed to add instructor" }, { status: 500 });
  }
}

// DELETE /api/cohorts/[id]/instructors?instructorId=...
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    let instructorId = searchParams.get("instructorId");

    // RULE: Instructor can only remove themselves
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      instructorId = userId;
    }

    if (!instructorId) {
      return NextResponse.json({ error: "Instructor ID is required" }, { status: 400 });
    }

    await prisma.cohort.update({
      where: { id },
      data: {
        instructors: {
          disconnect: { id: instructorId }
        }
      }
    });
    await syncCohortInstructors(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Remove instructor error:");
    return NextResponse.json({ error: "Failed to remove instructor" }, { status: 500 });
  }
}
