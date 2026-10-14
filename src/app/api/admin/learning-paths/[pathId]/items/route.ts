import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

// GET: all lessons in a learning path
export async function GET(
  req: Request,
  { params }: { params: Promise<{ pathId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !hasAnyRole(session.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const pathId = resolvedParams.pathId;

    const items = await prisma.learningPathItem.findMany({
      where: { learningPathId: pathId },
      orderBy: { order: "asc" },
      include: {
        lesson: {
          include: {
            module: {
              include: { program: true }
            }
          }
        }
      }
    });

    return NextResponse.json(items);
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_ITEMS_GET]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: add one or more lessons to a learning path
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pathId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !hasAnyRole(session.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const pathId = resolvedParams.pathId;
    const body = await req.json();
    const { lessonIds } = body; // Array of lesson IDs

    if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
      return NextResponse.json({ error: "lessonIds array is required" }, { status: 400 });
    }

    // Current max order
    const lastItem = await prisma.learningPathItem.findFirst({
      where: { learningPathId: pathId },
      orderBy: { order: "desc" },
      select: { order: true }
    });

    let currentOrder = lastItem ? lastItem.order + 1 : 0;
    const createdItems: any[] = [];

    // Add lessons in a transaction, skipping existing ones
    await prisma.$transaction(async (tx) => {
      for (const lessonId of lessonIds) {
        // Skip existing links (unique composite index)
        const existing = await tx.learningPathItem.findUnique({
          where: {
            learningPathId_lessonId: {
              learningPathId: pathId,
              lessonId: lessonId
            }
          }
        });

        if (!existing) {
          const newItem = await tx.learningPathItem.create({
            data: {
              learningPathId: pathId,
              lessonId: lessonId,
              order: currentOrder++
            }
          });
          createdItems.push(newItem);
        }
      }
    });

    logger.info(`[LEARNING_PATH_ITEMS_ADDED] User ${session.user.id} added ${createdItems.length} lessons to path ${pathId}`);
    return NextResponse.json(createdItems);
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_ITEMS_POST]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT: bulk reorder lessons (drag and drop)
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ pathId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !hasAnyRole(session.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const pathId = resolvedParams.pathId;
    const body = await req.json();
    const { items } = body; // Array of [{ id: string, order: number }]

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Invalid items format" }, { status: 400 });
    }

    // Update each item in a transaction
    await prisma.$transaction(
      items.map((item) =>
        prisma.learningPathItem.update({
          where: { 
            id: item.id,
            learningPathId: pathId // Scope guard
          },
          data: { order: item.order }
        })
      )
    );

    logger.info(`[LEARNING_PATH_ITEMS_REORDERED] User ${session.user.id} reordered items in path ${pathId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_ITEMS_PUT]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}