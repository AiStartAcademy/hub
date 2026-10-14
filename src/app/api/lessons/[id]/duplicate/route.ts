import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { duplicateLessonFull } from "@/lib/duplicateUtils";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      include: {
        module: {
          include: { program: { select: { name: true, id: true } } },
        },
      },
    });
    if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

    logger.info(`[API] Duplicating lesson ${id}`);
    const newId = await duplicateLessonFull({
      lessonId: id,
      targetModuleId: lesson.moduleId,
      targetCourseName: lesson.module.program.name,
      targetModuleName: lesson.module.name,
    });

    revalidatePath(`/courses/${lesson.module.program.id}`);
    return NextResponse.json({ success: true, newId });
  } catch (err) {
    logger.error({ err: err }, "[API] Duplicate lesson error:");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to duplicate lesson" },
      { status: 500 }
    );
  }
}