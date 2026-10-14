//  src/app/api/lessons/[id]/complete/route.ts

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkProgramAccess } from "@/lib/programAccess";
import { logger } from "@/lib/logger";

// POST /api/lessons/[id]/complete
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  try {
    const { id: lessonId } = await params;
    const body = await req.json();
    const { cohortId } = body;

    if (cohortId) {
      // Verify cohort exists if provided
      const cohort = await prisma.cohort.findUnique({
        where: { id: cohortId }
      });

      if (!cohort) {
        return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
      }
    }

    // Verify lesson exists and get programId for access check
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        module: { select: { programId: true } },
      },
    });

    if (!lesson) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }

    // Verify user has access to the program this lesson belongs to
    const programId = lesson.module.programId;
    const { hasAccess } = await checkProgramAccess(programId, userId);
    if (!hasAccess) {
      logger.info(`[complete] Access denied: userId=${userId} lessonId=${lessonId} programId=${programId}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      const existing = await prisma.lessonProgress.findFirst({
        where: {
          userId,
          lessonId,
          cohortId: cohortId || null
        }
      });

      if (!existing) {
        await prisma.lessonProgress.create({
          data: {
            userId,
            lessonId,
            ...(cohortId ? { cohortId } : {})
          }
        });
      }
    } catch (e: any) {
      // If it's a unique constraint violation, that's OK - lesson already marked complete
      if (e?.message && !e.message.includes("Unique constraint")) {
        throw e;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error( {err: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      userId,
      lessonId: params.then(p => p.id)
    }}, "Mark lesson complete error:" );
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Something went wrong" },
      { status: 500 }
    );
  }
}
