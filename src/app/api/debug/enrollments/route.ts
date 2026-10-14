import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

// DEBUG ONLY - Remove in production
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = (session.user as any).id;

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });

    // Get all enrollments for this user
    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      include: {
        cohort: {
          select: { id: true, title: true, status: true },
        },
      },
    });

    // Get all group memberships for this user
    const groupMembers = await prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            cohortId: true,
            cohort: {
              select: { id: true, title: true },
            },
          },
        },
      },
    });

    // Find ML Ops cohort
    const mlOpsCohort = await prisma.cohort.findFirst({
      where: {
        title: {
          contains: "ML Ops"
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        _count: {
          select: {
            enrollments: true,
            groups: true,
          },
        },
      },
    });

    // Get all enrollments for ML Ops cohort
    const mlOpsEnrollments = mlOpsCohort
      ? await prisma.enrollment.findMany({
          where: { cohortId: mlOpsCohort.id },
          select: { userId: true, status: true },
        })
      : [];

    return NextResponse.json({
      currentUser: user,
      userEnrollments: enrollments,
      userGroupMemberships: groupMembers,
      mlOpsCohort: mlOpsCohort,
      mlOpsEnrollments: mlOpsEnrollments,
      totalEnrollmentsInMlOps: mlOpsEnrollments.length,
      isUserInMlOps: mlOpsEnrollments.some(e => e.userId === userId),
    });
  } catch (error) {
    logger.error({ err: error }, "Debug error:");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Debug error" },
      { status: 500 }
    );
  }
}
