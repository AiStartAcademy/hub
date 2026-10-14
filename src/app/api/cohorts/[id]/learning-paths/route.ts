import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

// GET: all learning paths for a cohort
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !hasAnyRole(session.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const cohortId = resolvedParams.id;

    const learningPaths = await prisma.learningPath.findMany({
      where: { cohortId },
      orderBy: { order: "asc" },
      include: {
        _count: {
          select: { items: true }
        }
      }
    });

    return NextResponse.json(learningPaths);
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATHS_GET]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: create a learning path
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !hasAnyRole(session.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const cohortId = resolvedParams.id;
    const body = await req.json();
    const { title, description } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Max order, to append at the end
    const lastPath = await prisma.learningPath.findFirst({
      where: { cohortId },
      orderBy: { order: "desc" },
      select: { order: true }
    });

    const newOrder = lastPath ? lastPath.order + 1 : 0;

    const learningPath = await prisma.learningPath.create({
      data: {
        title,
        description,
        cohortId,
        order: newOrder
      }
    });

    logger.info(`[LEARNING_PATH_CREATED] User ${session.user.id} created path ${learningPath.id} in cohort ${cohortId}`);
    return NextResponse.json(learningPath);
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_POST]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}