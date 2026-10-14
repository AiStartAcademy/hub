import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ pathId: string }> }
) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { targetCohortId } = body;
    if (!targetCohortId) {
      return NextResponse.json({ error: "targetCohortId is required" }, { status: 400 });
    }

    const resolvedParams = await params;
    const pathId = resolvedParams.pathId;

    // Load the original path with all its lessons
    const originalPath = await prisma.learningPath.findUnique({
      where: { id: pathId },
      include: { items: true },
    });

    if (!originalPath) {
      return NextResponse.json({ error: "Path not found" }, { status: 404 });
    }

    // Max order in the target cohort, to append at the end
    const lastTargetPath = await prisma.learningPath.findFirst({
      where: { cohortId: targetCohortId },
      orderBy: { order: "desc" },
      select: { order: true }
    });
    const newOrder = lastTargetPath ? lastTargetPath.order + 1 : 0;

    // Copy the path into the target cohort under its original title
    const duplicatedPath = await prisma.learningPath.create({
      data: {
        title: originalPath.title, // no "(Copy)" suffix
        description: originalPath.description,
        cohortId: targetCohortId,
        order: newOrder,
        items: {
          create: originalPath.items.map((item) => ({
            lessonId: item.lessonId,
            order: item.order,
          }))
        }
      }
    });

    logger.info(`[LEARNING_PATH_DUPLICATED] User ${session?.user?.id} copied path ${pathId} to cohort ${targetCohortId}`);
    return NextResponse.json(duplicatedPath);
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_DUPLICATE_POST]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}