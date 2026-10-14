import prisma from "@/lib/prisma";
import {
  bucket,
  buildObjectKey,
  isGCSKey,
  copyGCSObject,
  copyGCSPrefix,
  rollbackGCSCopies,
  deleteGCSPrefix,
} from "@/lib/gcs";
import { logger } from "./logger";

// ─── Slug helper (mirrors toSlug in gcs.ts) ───────────────────────────────────

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Name collision helper ────────────────────────────────────────────────────

/**
 * Generates a unique name with " copy", " copy 2", " copy 3"... suffix
 * by checking existing names against the provided set.
 */
export function makeUniqueName(baseName: string, existingNames: Set<string>): string {
  const candidate = `${baseName} copy`;
  if (!existingNames.has(candidate)) return candidate;
  let i = 2;
  while (existingNames.has(`${baseName} copy ${i}`)) i++;
  return `${baseName} copy ${i}`;
}

// ─── GCS key remapping ────────────────────────────────────────────────────────

/**
 * Remaps a GCS key from one lesson path to another.
 * If the value is not a GCS key (external URL), returns it unchanged.
 */
function remapLessonKey(
  value: string | null | undefined,
  oldPrefix: string,
  newPrefix: string
): string | null {
  if (!value) return null;
  if (!isGCSKey(value)) return value; // external URL — keep as-is
  if (!value.startsWith(oldPrefix)) return value;
  return newPrefix + value.slice(oldPrefix.length);
}

// ─── Duplicate Lesson ─────────────────────────────────────────────────────────

export interface DuplicateLessonOptions {
  lessonId: string;
  targetModuleId: string;  // can be same module
  targetCourseName: string;
  targetModuleName: string;
}

export async function duplicateLessonFull(opts: DuplicateLessonOptions): Promise<string> {
  const { lessonId, targetModuleId, targetCourseName, targetModuleName } = opts;

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      quiz: {
        include: {
          items: {
            include: { options: { orderBy: { order: "asc" } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });
  if (!lesson) throw new Error("Lesson not found");

  // Resolve existing lesson names in target module
  const siblings = await prisma.lesson.findMany({
    where: { moduleId: targetModuleId },
    select: { name: true, order: true },
    orderBy: { order: "asc" },
  });
  const existingNames = new Set(siblings.map((s) => s.name));

  // Place new lesson right after original (if same module) or at end
  let insertOrder: number;
  if (targetModuleId === lesson.moduleId) {
    insertOrder = lesson.order + 1;
  } else {
    insertOrder = siblings.length > 0 ? siblings[siblings.length - 1].order + 1 : 0;
  }

  const newName = makeUniqueName(lesson.name, existingNames);

  // ── GCS copy ──
  const copied = new Map<string, string>();
  const oldLessonPrefix = buildObjectKey(
    targetCourseName, // will be overwritten — we need OLD course name
    targetModuleName, // same issue — need OLD names
    lesson.name,
    ""
  ).slice(0, -1); // remove trailing empty filename → get prefix

  // Actually we need old course/module names — get them:
  const sourceModule = await prisma.module.findUnique({
    where: { id: lesson.moduleId },
    include: { program: { select: { name: true } } },
  });
  if (!sourceModule) throw new Error("Source module not found");

  const srcLessonPrefix = `courses/${toSlug(sourceModule.program.name)}/${toSlug(sourceModule.name)}/${toSlug(lesson.name)}/`;
  const dstLessonPrefix = `courses/${toSlug(targetCourseName)}/${toSlug(targetModuleName)}/${toSlug(newName)}/`;

  try {
    const prefixCopied = await copyGCSPrefix(srcLessonPrefix, dstLessonPrefix);
    prefixCopied.forEach((v, k) => copied.set(k, v));
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }

  // ── DB write ──
  try {
    const newLesson = await prisma.$transaction(async (tx) => {
      // Shift lessons after insertion point if same module
      if (targetModuleId === lesson.moduleId) {
        await tx.lesson.updateMany({
          where: { moduleId: targetModuleId, order: { gte: insertOrder } },
          data: { order: { increment: 1 } },
        });
      }

      const created = await tx.lesson.create({
        data: {
          moduleId: targetModuleId,
          name: newName,
          duration: lesson.duration,
          type: lesson.type,
          text: lesson.text,
          intro: lesson.intro,
          timecodes: lesson.timecodes,
          tags: lesson.tags,
          order: insertOrder,
          // Remap GCS keys to new path
          videoUrl: remapLessonKey(lesson.videoUrl, srcLessonPrefix, dstLessonPrefix),
          audioUrl: remapLessonKey(lesson.audioUrl, srcLessonPrefix, dstLessonPrefix),
          captionsUrl: remapLessonKey(lesson.captionsUrl, srcLessonPrefix, dstLessonPrefix),
          dataUrl: remapLessonKey(lesson.dataUrl, srcLessonPrefix, dstLessonPrefix),
        },
      });

      // Touch parent module
      await tx.module.update({
        where: { id: targetModuleId },
        data: { updatedAt: new Date() },
      });

      // Duplicate quiz if exists
      if (lesson.quiz) {
        await tx.quiz.create({
          data: {
            lessonId: created.id,
            name: lesson.quiz.name,
            maxAttempts: lesson.quiz.maxAttempts,
            items: {
              create: lesson.quiz.items.map((item) => ({
                questionText: item.questionText,
                type: item.type,
                order: item.order,
                options: {
                  create: item.options.map((opt) => ({
                    text: opt.text,
                    isCorrect: opt.isCorrect,
                    order: opt.order,
                  })),
                },
              })),
            },
          },
        });
      }

      return created;
    });

    logger.info(`[duplicateLesson] Created lesson ${newLesson.id} ("${newName}")`);
    return newLesson.id;
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }
}

// ─── Duplicate Module ─────────────────────────────────────────────────────────

export interface DuplicateModuleOptions {
  moduleId: string;
  targetProgramId: string;
  onProgress?: (progress: number, message: string) => Promise<void>;
}

export async function duplicateModuleFull(opts: DuplicateModuleOptions): Promise<string> {
  const { moduleId, targetProgramId, onProgress } = opts;

  const sourceModule = await prisma.module.findUnique({
    where: { id: moduleId },
    include: {
      program: { select: { name: true } },
      lessons: {
        include: {
          quiz: {
            include: {
              items: {
                include: { options: { orderBy: { order: "asc" } } },
                orderBy: { order: "asc" },
              },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!sourceModule) throw new Error("Module not found");

  const targetProgram = await prisma.program.findUnique({
    where: { id: targetProgramId },
    select: { name: true },
  });
  if (!targetProgram) throw new Error("Target program not found");

  // Resolve module name collision in target program
  const siblingModules = await prisma.module.findMany({
    where: { programId: targetProgramId },
    select: { name: true, order: true },
    orderBy: { order: "desc" },
  });
  const existingModuleNames = new Set(siblingModules.map((m) => m.name));
  const newModuleName = makeUniqueName(sourceModule.name, existingModuleNames);
  const newModuleOrder = siblingModules.length > 0 ? siblingModules[0].order + 1 : 0;

  const totalLessons = sourceModule.lessons.length;
  const copied = new Map<string, string>();

  await onProgress?.(5, `Starting module duplication (${totalLessons} lessons)...`);

  // ── GCS copy per lesson ──
  for (let i = 0; i < sourceModule.lessons.length; i++) {
    const lesson = sourceModule.lessons[i];
    const srcPrefix = `courses/${toSlug(sourceModule.program.name)}/${toSlug(sourceModule.name)}/${toSlug(lesson.name)}/`;
    const dstPrefix = `courses/${toSlug(targetProgram.name)}/${toSlug(newModuleName)}/${toSlug(lesson.name)}/`;

    try {
      const lessonCopied = await copyGCSPrefix(srcPrefix, dstPrefix);
      lessonCopied.forEach((v, k) => copied.set(k, v));
    } catch (err) {
      await rollbackGCSCopies(copied);
      throw err;
    }

    const progress = Math.round(5 + ((i + 1) / totalLessons) * 60);
    await onProgress?.(progress, `Copied files for lesson "${lesson.name}"`);
  }

  await onProgress?.(70, "Writing to database...");

  // ── DB write ──
  try {
    const newModule = await prisma.$transaction(async (tx) => {
      const created = await tx.module.create({
        data: {
          programId: targetProgramId,
          name: newModuleName,
          description: sourceModule.description,
          order: newModuleOrder,
        },
      });

      for (const lesson of sourceModule.lessons) {
        const srcPrefix = `courses/${toSlug(sourceModule.program.name)}/${toSlug(sourceModule.name)}/${toSlug(lesson.name)}/`;
        const dstPrefix = `courses/${toSlug(targetProgram.name)}/${toSlug(newModuleName)}/${toSlug(lesson.name)}/`;

        const newLesson = await tx.lesson.create({
          data: {
            moduleId: created.id,
            name: lesson.name,
            duration: lesson.duration,
            type: lesson.type,
            text: lesson.text,
            intro: lesson.intro,
            timecodes: lesson.timecodes,
            tags: lesson.tags,
            order: lesson.order,
            videoUrl: remapLessonKey(lesson.videoUrl, srcPrefix, dstPrefix),
            audioUrl: remapLessonKey(lesson.audioUrl, srcPrefix, dstPrefix),
            captionsUrl: remapLessonKey(lesson.captionsUrl, srcPrefix, dstPrefix),
            dataUrl: remapLessonKey(lesson.dataUrl, srcPrefix, dstPrefix),
          },
        });

        if (lesson.quiz) {
          await tx.quiz.create({
            data: {
              lessonId: newLesson.id,
              name: lesson.quiz.name,
              maxAttempts: lesson.quiz.maxAttempts,
              items: {
                create: lesson.quiz.items.map((item) => ({
                  questionText: item.questionText,
                  type: item.type,
                  order: item.order,
                  options: {
                    create: item.options.map((opt) => ({
                      text: opt.text,
                      isCorrect: opt.isCorrect,
                      order: opt.order,
                    })),
                  },
                })),
              },
            },
          });
        }
      }

      // Touch target program
      await tx.program.update({
        where: { id: targetProgramId },
        data: { updatedAt: new Date() },
      });

      return created;
    });

    logger.info(`[duplicateModule] Created module ${newModule.id} ("${newModuleName}")`);
    await onProgress?.(100, "Done");
    return newModule.id;
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }
}

// ─── Duplicate Course ─────────────────────────────────────────────────────────

export interface DuplicateCourseOptions {
  programId: string;
  onProgress?: (progress: number, message: string) => Promise<void>;
}

export async function duplicateCourseFull(opts: DuplicateCourseOptions): Promise<string> {
  const { programId, onProgress } = opts;

  const sourceProgram = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      modules: {
        include: {
          lessons: {
            include: {
              quiz: {
                include: {
                  items: {
                    include: { options: { orderBy: { order: "asc" } } },
                    orderBy: { order: "asc" },
                  },
                },
              },
            },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!sourceProgram) throw new Error("Program not found");

  // Resolve course name collision
  const allPrograms = await prisma.program.findMany({ select: { name: true } });
  const existingNames = new Set(allPrograms.map((p) => p.name));
  const newCourseName = makeUniqueName(sourceProgram.name, existingNames);

  const totalLessons = sourceProgram.modules.reduce((s, m) => s + m.lessons.length, 0);
  let processedLessons = 0;
  const copied = new Map<string, string>();

  await onProgress?.(3, `Starting course duplication (${sourceProgram.modules.length} modules, ${totalLessons} lessons)...`);

  // ── GCS copy: entire course prefix ──
  const srcCoursePrefix = `courses/${toSlug(sourceProgram.name)}/`;
  const dstCoursePrefix = `courses/${toSlug(newCourseName)}/`;

  try {
    const courseCopied = await copyGCSPrefix(srcCoursePrefix, dstCoursePrefix);
    courseCopied.forEach((v, k) => copied.set(k, v));
    await onProgress?.(50, `Copied ${courseCopied.size} files from GCS`);
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }

  await onProgress?.(55, "Writing to database...");

  // ── DB write ──
  try {
    const newProgram = await prisma.$transaction(async (tx) => {
      const created = await tx.program.create({
        data: {
          name: newCourseName,
          description: sourceProgram.description,
          status: "draft", // always start as draft
          cover: sourceProgram.cover,
        },
      });

      for (const mod of sourceProgram.modules) {
        const createdModule = await tx.module.create({
          data: {
            programId: created.id,
            name: mod.name,
            description: mod.description,
            order: mod.order,
          },
        });

        for (const lesson of mod.lessons) {
          const srcPrefix = `courses/${toSlug(sourceProgram.name)}/${toSlug(mod.name)}/${toSlug(lesson.name)}/`;
          const dstPrefix = `courses/${toSlug(newCourseName)}/${toSlug(mod.name)}/${toSlug(lesson.name)}/`;

          const newLesson = await tx.lesson.create({
            data: {
              moduleId: createdModule.id,
              name: lesson.name,
              duration: lesson.duration,
              type: lesson.type,
              text: lesson.text,
              intro: lesson.intro,
              timecodes: lesson.timecodes,
              tags: lesson.tags,
              order: lesson.order,
              videoUrl: remapLessonKey(lesson.videoUrl, srcPrefix, dstPrefix),
              audioUrl: remapLessonKey(lesson.audioUrl, srcPrefix, dstPrefix),
              captionsUrl: remapLessonKey(lesson.captionsUrl, srcPrefix, dstPrefix),
              dataUrl: remapLessonKey(lesson.dataUrl, srcPrefix, dstPrefix),
            },
          });

          if (lesson.quiz) {
            await tx.quiz.create({
              data: {
                lessonId: newLesson.id,
                name: lesson.quiz.name,
                maxAttempts: lesson.quiz.maxAttempts,
                items: {
                  create: lesson.quiz.items.map((item) => ({
                    questionText: item.questionText,
                    type: item.type,
                    order: item.order,
                    options: {
                      create: item.options.map((opt) => ({
                        text: opt.text,
                        isCorrect: opt.isCorrect,
                        order: opt.order,
                      })),
                    },
                  })),
                },
              },
            });
          }

          processedLessons++;
          const progress = 55 + Math.round((processedLessons / totalLessons) * 40);
          await onProgress?.(progress, `Created lesson "${lesson.name}" in module "${mod.name}"`);
        }
      }

      return created;
    });

    logger.info(`[duplicateCourse] Created course ${newProgram.id} ("${newCourseName}")`);
    await onProgress?.(100, "Done");
    return newProgram.id;
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }
}

// ─── Move Lesson ──────────────────────────────────────────────────────────────

export interface MoveLessonOptions {
  lessonId: string;
  targetModuleId: string;
}

export async function moveLessonFull(opts: MoveLessonOptions): Promise<void> {
  const { lessonId, targetModuleId } = opts;

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { include: { program: { select: { name: true } } } } },
  });
  if (!lesson) throw new Error("Lesson not found");

  if (lesson.moduleId === targetModuleId) return; // no-op

  const targetModule = await prisma.module.findUnique({
    where: { id: targetModuleId },
    include: { program: { select: { name: true } } },
  });
  if (!targetModule) throw new Error("Target module not found");

  const srcPrefix = `courses/${toSlug(lesson.module.program.name)}/${toSlug(lesson.module.name)}/${toSlug(lesson.name)}/`;
  const dstPrefix = `courses/${toSlug(targetModule.program.name)}/${toSlug(targetModule.name)}/${toSlug(lesson.name)}/`;

  const copied = new Map<string, string>();

  // ── GCS move (copy + delete src) ──
  try {
    if (srcPrefix !== dstPrefix) {
      const prefixCopied = await copyGCSPrefix(srcPrefix, dstPrefix);
      prefixCopied.forEach((v, k) => copied.set(k, v));
    }
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }

  // ── DB write ──
  try {
    const targetSiblings = await prisma.lesson.findMany({
      where: { moduleId: targetModuleId },
      orderBy: { order: "asc" },
      select: { order: true },
    });
    const newOrder = 0; // place at top per spec

    await prisma.$transaction(async (tx) => {
      // Shift existing lessons in target module down
      await tx.lesson.updateMany({
        where: { moduleId: targetModuleId },
        data: { order: { increment: 1 } },
      });

      // Remap GCS keys in lesson fields
      await tx.lesson.update({
        where: { id: lessonId },
        data: {
          moduleId: targetModuleId,
          order: newOrder,
          updatedAt: new Date(),
          videoUrl: remapLessonKey(lesson.videoUrl, srcPrefix, dstPrefix),
          audioUrl: remapLessonKey(lesson.audioUrl, srcPrefix, dstPrefix),
          captionsUrl: remapLessonKey(lesson.captionsUrl, srcPrefix, dstPrefix),
          dataUrl: remapLessonKey(lesson.dataUrl, srcPrefix, dstPrefix),
        },
      });

      // Reindex old module
      const remaining = await tx.lesson.findMany({
        where: { moduleId: lesson.moduleId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      await Promise.all(
        remaining.map((l, i) =>
          tx.lesson.update({ where: { id: l.id }, data: { order: i } })
        )
      );

      // Touch both modules and both programs
      await tx.module.update({ where: { id: lesson.moduleId }, data: { updatedAt: new Date() } });
      await tx.module.update({ where: { id: targetModuleId }, data: { updatedAt: new Date() } });
      await tx.program.update({
        where: { id: lesson.module.programId },
        data: { updatedAt: new Date() },
      });
      if (targetModule.programId !== lesson.module.programId) {
        await tx.program.update({
          where: { id: targetModule.programId },
          data: { updatedAt: new Date() },
        });
      }
    });

    // Delete old GCS files only after successful DB write
    if (srcPrefix !== dstPrefix && copied.size > 0) {
      for (const srcKey of copied.keys()) {
        await bucket.file(srcKey).delete({ ignoreNotFound: true });
      }
      logger.info(`[moveLesson] Deleted ${copied.size} old GCS files from ${srcPrefix}`);
    }

    logger.info(`[moveLesson] Lesson ${lessonId} moved to module ${targetModuleId}`);
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }
}

// ─── Move Module ──────────────────────────────────────────────────────────────

export interface MoveModuleOptions {
  moduleId: string;
  targetProgramId: string;
}

export async function moveModuleFull(opts: MoveModuleOptions): Promise<void> {
  const { moduleId, targetProgramId } = opts;

  const sourceModule = await prisma.module.findUnique({
    where: { id: moduleId },
    include: {
      program: { select: { name: true } },
      lessons: { select: { id: true, name: true, videoUrl: true, audioUrl: true, captionsUrl: true, dataUrl: true } },
    },
  });
  if (!sourceModule) throw new Error("Module not found");
  if (sourceModule.programId === targetProgramId) return;

  const targetProgram = await prisma.program.findUnique({
    where: { id: targetProgramId },
    select: { name: true },
  });
  if (!targetProgram) throw new Error("Target program not found");

  const srcModulePrefix = `courses/${toSlug(sourceModule.program.name)}/${toSlug(sourceModule.name)}/`;
  const dstModulePrefix = `courses/${toSlug(targetProgram.name)}/${toSlug(sourceModule.name)}/`;

  const copied = new Map<string, string>();

  // ── GCS move ──
  try {
    if (srcModulePrefix !== dstModulePrefix) {
      const prefixCopied = await copyGCSPrefix(srcModulePrefix, dstModulePrefix);
      prefixCopied.forEach((v, k) => copied.set(k, v));
    }
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }

  // ── DB write ──
  try {
    const targetModuleCount = await prisma.module.count({ where: { programId: targetProgramId } });

    await prisma.$transaction(async (tx) => {
      // Update each lesson's GCS URLs
      for (const lesson of sourceModule.lessons) {
        const srcPrefix = `courses/${toSlug(sourceModule.program.name)}/${toSlug(sourceModule.name)}/${toSlug(lesson.name)}/`;
        const dstPrefix = `courses/${toSlug(targetProgram.name)}/${toSlug(sourceModule.name)}/${toSlug(lesson.name)}/`;

        await tx.lesson.update({
          where: { id: lesson.id },
          data: {
            videoUrl: remapLessonKey(lesson.videoUrl, srcPrefix, dstPrefix),
            audioUrl: remapLessonKey(lesson.audioUrl, srcPrefix, dstPrefix),
            captionsUrl: remapLessonKey(lesson.captionsUrl, srcPrefix, dstPrefix),
            dataUrl: remapLessonKey(lesson.dataUrl, srcPrefix, dstPrefix),
            updatedAt: new Date(),
          },
        });
      }

      // Move module to target program (place at top per spec)
      // Shift existing modules in target program
      await tx.module.updateMany({
        where: { programId: targetProgramId },
        data: { order: { increment: 1 } },
      });

      await tx.module.update({
        where: { id: moduleId },
        data: {
          programId: targetProgramId,
          order: 0,
          updatedAt: new Date(),
        },
      });

      // Reindex old program modules
      const remaining = await tx.module.findMany({
        where: { programId: sourceModule.programId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      await Promise.all(
        remaining.map((m, i) =>
          tx.module.update({ where: { id: m.id }, data: { order: i } })
        )
      );

      // Touch both programs
      await tx.program.update({ where: { id: sourceModule.programId }, data: { updatedAt: new Date() } });
      await tx.program.update({ where: { id: targetProgramId }, data: { updatedAt: new Date() } });
    });

    // Delete old GCS files
    if (srcModulePrefix !== dstModulePrefix && copied.size > 0) {
      for (const srcKey of copied.keys()) {
        await bucket.file(srcKey).delete({ ignoreNotFound: true });
      }
      logger.info(`[moveModule] Deleted ${copied.size} old GCS files`);
    }

    logger.info(`[moveModule] Module ${moduleId} moved to program ${targetProgramId}`);
  } catch (err) {
    await rollbackGCSCopies(copied);
    throw err;
  }
}