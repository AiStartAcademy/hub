import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const items = body as { id: string; order: number }[];

    if (!Array.isArray(items) || items.some((i) => !i.id || i.order === undefined)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    logger.info(`[lessons/reorder] Reordering ${items.length} lessons`);

    await prisma.$transaction(
      items.map(({ id, order }) =>
        prisma.lesson.update({
          where: { id },
          data: { order },
        })
      )
    );

    logger.info(`[lessons/reorder] Done`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, "[lessons/reorder] Error:");
    return NextResponse.json({ error: "Failed to reorder lessons" }, { status: 500 });
  }
}