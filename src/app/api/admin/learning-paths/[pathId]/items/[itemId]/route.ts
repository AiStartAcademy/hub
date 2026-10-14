import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ pathId: string, itemId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || !hasAnyRole(session.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const pathId = resolvedParams.pathId;
    const itemId = resolvedParams.itemId;

    await prisma.learningPathItem.delete({
      where: {
        id: itemId,
        learningPathId: pathId
      }
    });

    logger.info(`[LEARNING_PATH_ITEM_DELETED] User ${session.user.id} removed item ${itemId} from path ${pathId}`);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error({ err: error }, "[LEARNING_PATH_ITEM_DELETE]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}