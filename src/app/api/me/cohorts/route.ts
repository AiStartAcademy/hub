import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = (session.user as any).id;
    logger.info("Fetching cohorts for userId:", userId);

    // First, get all enrollments for this user to debug
    const userEnrollments = await prisma.enrollment.findMany({
      where: { userId },
      select: { cohortId: true, status: true },
    });
    logger.info( {data: userEnrollments}, "User enrollments:");

    // Get cohorts where user is enrolled as student - try without status filter first
    const enrolledCohorts = await prisma.cohort.findMany({
      where: {
        enrollments: {
          some: {
            userId: userId,
            // Don't filter by status for now
          },
        },
      },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        status: true,
        deliveryMode: true,
        programs: {
          select: {
            id: true,
            name: true
          }
        },
      },
      orderBy: [
        { startDate: "asc" },
        { createdAt: "desc" },
      ],
    });
    logger.info({data: enrolledCohorts}, "Enrolled cohorts:");

    // Get cohorts where user is instructor
    const instructorCohorts = await prisma.cohort.findMany({
      where: {
        instructors: {
          some: {
            id: userId,
          },
        },
      },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        status: true,
        deliveryMode: true,
        programs: {
          select: {
            id: true,
            name: true
          }
        },
      },
      orderBy: {
        startDate: "asc",
      },
    });
    logger.info({data: instructorCohorts}, "Instructor cohorts:" );

    // Also get cohorts from group memberships (when admin adds user)
    const groupMembershipCohorts = await prisma.cohort.findMany({
      where: {
        groups: {
          some: {
            members: {
              some: {
                userId: userId,
              },
            },
          },
        },
      },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        status: true,
        deliveryMode: true,
        programs: {
          select: {
            id: true,
            name: true
          }
        },
      },
      orderBy: {
        startDate: "asc",
      },
    });
    logger.info( {data: groupMembershipCohorts},"Group membership cohorts:");

    // Combine and deduplicate
    const cohortMap = new Map();

    enrolledCohorts.forEach(cohort => {
      cohortMap.set(cohort.id, { ...cohort, role: "student" });
    });

    groupMembershipCohorts.forEach(cohort => {
      if (cohortMap.has(cohort.id)) {
        const existing = cohortMap.get(cohort.id);
        existing.role = "student"; // Group membership = student
      } else {
        cohortMap.set(cohort.id, { ...cohort, role: "student" });
      }
    });

    instructorCohorts.forEach(cohort => {
      if (cohortMap.has(cohort.id)) {
        // User is both student and instructor
        const existing = cohortMap.get(cohort.id);
        existing.role = "both";
      } else {
        cohortMap.set(cohort.id, { ...cohort, role: "instructor" });
      }
    });

    const cohorts = Array.from(cohortMap.values());

    return NextResponse.json({
      cohorts,
      total: cohorts.length,
    });
  } catch (error) {
    logger.error({ err: error }, "Fetch user cohorts error:");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch cohorts: ${errorMessage}` },
      { status: 500 }
    );
  }
}
