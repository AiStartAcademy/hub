import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

// POST /api/groups/[groupId]/leave — user leaves a group
export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = (session.user as any).id;
    const { groupId } = await params;

    // Find the member record
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      include: {
        group: {
          select: { cohortId: true },
        },
      },
    });

    if (!member) {
      return NextResponse.json({ error: "Not a member of this group" }, { status: 404 });
    }

    const cohortId = member.group.cohortId;

    // Delete the group membership
    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });

    // If the user is no longer in any group of this cohort, remove their enrollment
    const remainingMemberships = await prisma.groupMember.count({
      where: {
        userId,
        group: { cohortId },
      },
    });

    if (remainingMemberships === 0) {
      await prisma.enrollment.deleteMany({
        where: { userId, cohortId },
      });
    }

    return NextResponse.json({ success: true, message: "You have left the group" });
  } catch (error) {
    logger.error({ err: error }, "Leave group error:");
    const errorMessage = error instanceof Error ? error.message : "Failed to leave group";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
