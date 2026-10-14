import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// DELETE /api/cohorts/[id]/groups/[groupId]/members/[memberId]
export async function DELETE(
  req: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; groupId: string; memberId: string }>;
  }
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
    const { id: cohortId, groupId, memberId } = await params;

    // Get the member record to know the userId before deleting
    const member = await prisma.groupMember.findUnique({
      where: { id: memberId },
      include: { group: { include: { cohort: { include: { instructors: { select: { id: true } } } } } } },
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Verify group belongs to the cohort
    if (member.group.cohortId !== cohortId) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Check if instructor is assigned to this cohort
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      const isAssigned = member.group.cohort.instructors.some(inst => inst.id === userId);
      if (!isAssigned) {
        return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
      }
    }

    await prisma.groupMember.delete({ where: { id: memberId } });

    // If the user is no longer in any group of this cohort, remove their enrollment
    const remainingMemberships = await prisma.groupMember.count({
      where: {
        userId: member.userId,
        group: { cohortId },
      },
    });
    if (remainingMemberships === 0) {
      await prisma.enrollment.deleteMany({
        where: { userId: member.userId, cohortId },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Remove group member error:");
    return NextResponse.json(
      { error: "Failed to remove member" },
      { status: 500 }
    );
  }
}
