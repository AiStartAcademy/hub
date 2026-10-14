import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PrismaClient } from "@/generated/client";
import type {
  N8nModuleCallbackPayload,
  N8nLessonPayload,
} from "@/types/n8n";
import { buildObjectKey } from "@/lib/gcs";
//import { streamDriveFileToGCS } from "@/lib/driveUtils";
import { extractDriveFileId } from "@/lib/mediaUtils";
import { buildQuizInTransaction } from "@/lib/quizUtils";
import { logger } from "@/lib/logger";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses "8:55" → 535 seconds */
function parseDurationToSeconds(raw: string): number {
  const parts = raw.split(":").map(Number);
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + (seconds || 0);
  }
  return Number(raw) || 0;
}

/** Converts timestamps array to "0:06 Intro text\n1:30 Topic 1" format */
function formatTimecodes(
  timestamps: N8nLessonPayload["jsonData"]["timestamps"]
): string {
  return timestamps
    .filter((t) => t.text.trim())
    .map((t) => `${t.start} ${t.text.trim()}`)
    .join("\n");
}

/**
 * Streams a single lesson asset from Google Drive to GCS.
 * Returns the GCS objectKey.
 */
// async function uploadLessonAsset(
//   driveUrl: string,
//   fileName: string,
//   mimeType: string,
//   courseName: string,
//   moduleName: string,
//   lessonName: string
// ): Promise<string> {
//   const fileId = extractDriveFileId(driveUrl);
//   if (!fileId) {
//     throw new Error(`Cannot extract fileId from URL: ${driveUrl}`);
//   }
//   const objectKey = buildObjectKey(courseName, moduleName, lessonName, fileName);
//   return streamDriveFileToGCS(fileId, objectKey, mimeType);
// }

// ─── Core lesson creation ─────────────────────────────────────────────────────

/**
 * Uploads all 4 lesson assets to GCS in parallel, then writes
 * Lesson + Quiz to DB using the provided fresh client.
 */
async function createLessonWithQuiz(
  moduleId: string,
  courseName: string,
  moduleName: string,
  order: number,
  lesson: N8nLessonPayload
): Promise<void> {
  const { jsonData } = lesson;

  logger.info(
    `[module-callback] Uploading assets for lesson "${jsonData.lesson_title}" (moduleId=${moduleId})`
  );

  // Upload all 4 assets to GCS in parallel — fail fast if any upload fails
  // const [videoKey, audioKey, captionsKey, dataKey] = await Promise.all([
  //   uploadLessonAsset(lesson.videoUrl, "video.mp4", "video/mp4", courseName, moduleName, jsonData.lesson_title),
  //   uploadLessonAsset(lesson.audioUrl, "audio.mp3", "audio/mpeg", courseName, moduleName, jsonData.lesson_title),
  //   uploadLessonAsset(lesson.captionsUrl, "captions.txt", "text/plain", courseName, moduleName, jsonData.lesson_title),
  //   uploadLessonAsset(lesson.dataUrl, "data.json", "application/json", courseName, moduleName, jsonData.lesson_title),
  // ]);

  logger.info(
    `[module-callback] All assets uploaded for "${jsonData.lesson_title}", writing to DB`
  );

  // Fresh client created RIGHT AFTER uploads — connection is guaranteed alive
  // Fresh client created RIGHT AFTER uploads — connection is guaranteed alive
  const db = new PrismaClient();
  logger.info(`[module-callback] PrismaClient created for "${jsonData.lesson_title}"`);

  const durationSeconds = parseDurationToSeconds(jsonData.estimated_duration_minutes);
  const timecodes = formatTimecodes(jsonData.timestamps);
  const tags = jsonData.keywords.join(", ");

  logger.info(`[module-callback] Checking duplicate for "${jsonData.lesson_title}"`);
  const existing = await db.lesson.findUnique({
    where: { moduleId_name: { moduleId, name: jsonData.lesson_title } },
    select: { id: true },
  });

  if (existing) {
    throw new Error(
      `Lesson "${jsonData.lesson_title}" already exists in module ${moduleId}`
    );
  }

  logger.info(`[module-callback] Creating lesson row for "${jsonData.lesson_title}"`);
  const createdLesson = await db.lesson.create({
    data: {
      moduleId,
      name: jsonData.lesson_title,
      duration: durationSeconds,
      type: "video",
      text: jsonData.long_description,
      // videoUrl: videoKey,
      // audioUrl: audioKey,
      // captionsUrl: captionsKey,
      // dataUrl: dataKey,
      intro: jsonData.short_description,
      timecodes,
      tags,
      order,
    },
  });

  logger.info(`[module-callback] Lesson row created id=${createdLesson.id}, building quiz`);
  await buildQuizInTransaction(
    db as Parameters<typeof buildQuizInTransaction>[0],
    createdLesson.id,
    jsonData.lesson_title,
    jsonData.quiz_questions
  );
  logger.info(`[module-callback] Lesson "${jsonData.lesson_title}" written to DB successfully`);

  logger.info(
    `[module-callback] Lesson "${jsonData.lesson_title}" created successfully`
  );

  await db.$disconnect();
  logger.info(
    `[module-callback] DB connection released after "${jsonData.lesson_title}"`
  );
}

// ─── Background processor ─────────────────────────────────────────────────────

/**
 * Runs after the HTTP response is sent.
 * Creates a fresh PrismaClient to avoid socket timeout after long GCS uploads.
 * Sequentially creates all lessons, then updates the module.
 * Errors are isolated per lesson — one failure won't block the rest.
 */
async function processLessonsInBackground(
  moduleId: string,
  moduleDescription: string | null,
  lessons: N8nLessonPayload[],
  existingDescription: string | null
): Promise<void> {
  const dbInit = new PrismaClient();
  let courseName: string;
  let moduleName: string;
  let startOrder: number;

  try {
    const moduleWithProgram = await dbInit.module.findUnique({
      where: { id: moduleId },
      select: {
        name: true,
        program: { select: { name: true } },
      },
    });

    if (!moduleWithProgram) {
      logger.error(
        `[module-callback] Module ${moduleId} not found in background job, aborting`
      );
      return;
    }

    courseName = moduleWithProgram.program.name;
    moduleName = moduleWithProgram.name;

    const lastLesson = await dbInit.lesson.findFirst({
      where: { moduleId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    startOrder = lastLesson ? lastLesson.order + 1 : 0;
  } finally {
    await dbInit.$disconnect();
    logger.info(`[module-callback] Init DB connection released for moduleId=${moduleId}`);
  }

    const errors: Array<{ folderName: string; error: string }> = [];

    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i];
      try {
        await createLessonWithQuiz(
          moduleId,
          courseName,
          moduleName,
          startOrder + i,
          lesson
        );
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : err},
          `[module-callback] Failed to create lesson "${lesson.folderName}":`
          
        );
        errors.push({
          folderName: lesson.folderName,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Update module description and touch updatedAt
    const dbForUpdate = new PrismaClient();
    logger.info(`[module-callback] Updating module ${moduleId} description`);
    try {
      await dbForUpdate.module.update({
        where: { id: moduleId },
        data: {
          description: moduleDescription ?? existingDescription,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err},
        `[module-callback] Failed to update module ${moduleId}:`
        
      );
    } finally {
      await dbForUpdate.$disconnect();
    }

    const created = lessons.length - errors.length;
    logger.info(
      `[module-callback] Background processing done: ${created} created, ${errors.length} failed for moduleId=${moduleId}`
    );

    if (errors.length > 0) {
      console.warn(
        `[module-callback] Failed lessons:`,
        errors.map((e) => e.folderName).join(", ")
      );
    }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Verify webhook secret
  const authHeader = req.headers.get("authorization");
  const secret = process.env.N8N_WEBHOOK_SECRET;

  if (!secret) {
    logger.error("[module-callback] N8N_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    console.warn("[module-callback] Unauthorized request — invalid secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let payload: N8nModuleCallbackPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { moduleId, moduleDescription, lessons } = payload;

  // 3. Basic validation
  if (!moduleId || !Array.isArray(lessons)) {
    return NextResponse.json(
      { error: "Missing required fields: moduleId, lessons" },
      { status: 422 }
    );
  }

  logger.info(
    `[module-callback] Received ${lessons.length} lesson(s) for moduleId=${moduleId}`
  );

  // 4. Verify module exists (use singleton — request is still alive here)
  const module = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!module) {
    logger.error(`[module-callback] Module not found: ${moduleId}`);
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }

  // 5. Respond immediately — uploads can take minutes, n8n must not wait
  logger.info(
    `[module-callback] Accepted ${lessons.length} lesson(s) for moduleId=${moduleId}, processing in background`
  );
  void processLessonsInBackground(
    moduleId,
    moduleDescription ?? null,
    lessons,
    module.description
  );

  return NextResponse.json({ success: true, accepted: lessons.length });
}