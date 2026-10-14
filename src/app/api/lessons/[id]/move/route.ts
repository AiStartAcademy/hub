import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { moveLessonFull } from "@/lib/duplicateUtils";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { targetModuleId } = await req.json() as { targetModuleId: string };

  if (!targetModuleId) {
    return NextResponse.json({ error: "targetModuleId is required" }, { status: 400 });
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: { module: { select: { programId: true } } },
    });
    if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

    const targetModule = await prisma.module.findUnique({
      where: { id: targetModuleId },
      select: { programId: true },
    });
    if (!targetModule) return NextResponse.json({ error: "Target module not found" }, { status: 404 });

    logger.info(`[API] Moving lesson ${id} to module ${targetModuleId}`);
    await moveLessonFull({ lessonId: id, targetModuleId });

    revalidatePath(`/courses/${lesson.module.programId}`);
    revalidatePath(`/courses/${targetModule.programId}`);

    return NextResponse.json({ success: true, targetProgramId: targetModule.programId });
  } catch (err) {
    logger.error({ err: err }, "[API] Move lesson error:");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to move lesson" },
      { status: 500 }
    );
  }
}