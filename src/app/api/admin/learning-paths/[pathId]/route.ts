import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function PATCH(
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
    const { title, description, order } = body;

    const updatedPath = await prisma.learningPath.update({
      where: { id: pathId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(order !== undefined && { order }),
      }
    });

    logger.info(`[LEARNING_PATH_UPDATED] User ${session.user.id} updated path ${pathId}`);
    return NextResponse.json(updatedPath);
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_PATCH]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
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

    await prisma.learningPath.delete({
      where: { id: pathId }
    });

    logger.info(`[LEARNING_PATH_DELETED] User ${session.user.id} deleted path ${pathId}`);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_DELETE]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}