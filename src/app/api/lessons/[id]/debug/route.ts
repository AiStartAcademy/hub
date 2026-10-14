// src/app/api/lessons/[id]/debug/route.ts

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// GET /api/lessons/[id]/debug?cohortId=xxx
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = (session.user as { id?: string })?.id ?? "";
  const { searchParams } = new URL(req.url);
  const cohortId = searchParams.get("cohortId");

  try {
    const { id: lessonId } = await params;

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { program: true } } }
    });

    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId || "" }
    });

    const existingProgress = cohortId
      ? await prisma.lessonProgress.findUnique({
          where: {
            userId_lessonId_cohortId: {
              userId,
              lessonId,
              cohortId
            }
          }
        })
      : null;

    return NextResponse.json({
      lesson: lesson ? { id: lesson.id, name: lesson.name, moduleId: lesson.moduleId } : null,
      cohort: cohort ? { id: cohort.id, title: cohort.title } : null,
      existingProgress: existingProgress ? { id: existingProgress.id, createdAt: existingProgress.createdAt } : null,
      user: { id: userId },
      cohortIdParam: cohortId
    });
  } catch (error) {
    logger.error({ err: error }, "Debug error:");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Something went wrong" },
      { status: 500 }
    );
  }
}
