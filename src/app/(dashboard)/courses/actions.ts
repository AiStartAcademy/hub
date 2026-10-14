// src/app/(dashboard)/courses/actions.ts

"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { extractDriveFileId } from "@/lib/mediaUtils";
import { buildQuizInTransaction } from "@/lib/quizUtils";
import { getDriveAccessToken } from "@/lib/googleDrive";
import { deleteFromGCS } from "@/lib/gcs";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { ACCESS_MODES, isSelfEnrollMode } from "@/lib/programAccess";
import { MATERIAL_TYPES } from "@/lib/programMaterials";


interface N8nWebhookPayload {
  programName: string;
  moduleName: string;
  moduleId: string;
  googleDriveUrl: string;
}

async function isAuthorized() {
  const session = await auth();
  return hasAnyRole(session?.user, MANAGE_ROLES);
}

export async function enrollInProgram(programId: string) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) throw new Error("Unauthorized");

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, locked: true, accessMode: true },
  });
  if (!program) throw new Error("Program not found");

  if (program.locked) {
    throw new Error("This course is locked and cannot be self-enrolled.");
  }

  // Being signed in is not an entitlement. Only free-by-design modes may be
  // self-joined; cohort/member/direct content requires a real grant (paid seat,
  // active membership, or staff-issued ProgramAccess). See SELF_ENROLL_MODES.
  if (!isSelfEnrollMode(program.accessMode)) {
    console.warn(
      `[enrollInProgram] Refused self-enroll: user=${userId} program=${programId} accessMode=${program.accessMode}`
    );
    throw new Error(
      "This course isn't open for self-enrollment. Access comes with a cohort seat, an active membership, or an invite from the team."
    );
  }

  // Create or ignore if already enrolled
  await prisma.programEnrollment.upsert({
    where: { userId_programId: { userId, programId } },
    update: {},
    create: { userId, programId },
  });

  revalidatePath(`/courses/${programId}`);
  return { success: true };
}

export async function createProgram(data: {
  name: string;
  description: string;
  status: string;
  locked?: boolean;
  accessMode?: string;
  cover?: string | null;
}) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  // Validate against the enum, as the other two write paths do
  // (api/admin/programs/[programId]/access, api/internal/mcp/v1/programs).
  // checkProgramAccess fails closed on an unrecognised mode, so an off-enum
  // value here would silently make a course unreachable for everyone.
  const accessMode = data.accessMode ?? "cohort";
  if (!(ACCESS_MODES as readonly string[]).includes(accessMode)) {
    throw new Error(`Invalid accessMode: ${accessMode}`);
  }

  const program = await prisma.program.create({
    data: {
      name: data.name,
      description: data.description,
      cover: data.cover || null,
      status: data.status,
      accessMode,
      locked: data.locked ?? false,
    },
  });

  console.log(`[createProgram] Created program "${program.name}" id=${program.id} accessMode=${program.accessMode}`);
  revalidatePath("/courses");
  return program;
}

export async function updateProgram(id: string, data: { name?: string; description?: string; status?: string; locked?: boolean; cover?: string | null }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  console.log("[updateProgram] data =", JSON.stringify(data));

  // Only update if there are fields to update
  const program = Object.keys(data).length > 0
    ? await prisma.program.update({ where: { id }, data })
    : await prisma.program.findUnique({ where: { id } });

  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
  return program;
}

export async function deleteProgram(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  // Collect all GCS assets from all nested lessons before deletion
  const program = await prisma.program.findUnique({
    where: { id },
    select: {
      name: true,
      cover: true,
      modules: {
        select: {
          lessons: {
            select: {
              id: true,
              videoUrl: true,
              posterUrl: true,
              audioUrl: true,
              captionsUrl: true,
              dataUrl: true,
            },
          },
        },
      },
    },
  });
  if (!program) throw new Error("Program not found");

  const lessonCount = program.modules.reduce((acc, m) => acc + m.lessons.length, 0);
  console.log(`[deleteProgram] Deleting program ${id} "${program.name}" with ${lessonCount} lessons`);

  await prisma.program.delete({ where: { id } });
  console.log(`[deleteProgram] Deleted program ${id} from DB`);

  // Collect all GCS keys: cover + all lesson assets
  const gcsKeys = [
    program.cover,
    ...program.modules.flatMap((m) =>
      m.lessons.flatMap((l) =>
        [l.videoUrl, l.posterUrl, l.audioUrl, l.captionsUrl, l.dataUrl]
      )
    ),
  ].filter((v): v is string => !!v);

  if (gcsKeys.length > 0) {
    console.log(`[deleteProgram] Cleaning ${gcsKeys.length} GCS asset(s) for program ${id}`);
    await Promise.all(gcsKeys.map((url) => deleteFromGCS(url)));
  }

  revalidatePath("/courses");
}

export async function createModule(programId: string, data: { name: string; description: string }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  // Get last order
  const lastMod = await prisma.module.findFirst({
    where: { programId },
    orderBy: { order: "desc" },
  });
  const order = lastMod ? lastMod.order + 1 : 0;

  const module = await prisma.module.create({
    data: {
      programId,
      name: data.name,
      description: data.description,
      order,
    },
  });
  revalidatePath(`/courses/${programId}`);
  return module;
}

export async function addProgramMaterial(
  programId: string,
  data: { title: string; type: string; url: string }
) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  const title = data.title.trim();
  const url = data.url.trim();
  if (!title) throw new Error("Material title is required");
  if (!url) throw new Error("Material URL is required");
  if (!(MATERIAL_TYPES as readonly string[]).includes(data.type)) {
    throw new Error(`Invalid material type: ${data.type}`);
  }

  let isSafeUrl = /^\/(?!\/)/.test(url);
  if (!isSafeUrl) {
    try {
      const parsedUrl = new URL(url);
      isSafeUrl = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
      isSafeUrl = false;
    }
  }

  // This value lands directly in an anchor href, so executable schemes such as
  // javascript: must never reach the course page.
  if (!isSafeUrl) {
    throw new Error("Material URL must use http://, https://, or a root-relative path");
  }

  const lastMaterial = await prisma.programMaterial.findFirst({
    where: { programId },
    orderBy: { order: "desc" },
  });
  const order = lastMaterial ? lastMaterial.order + 1 : 0;

  const material = await prisma.programMaterial.create({
    data: {
      programId,
      title,
      type: data.type,
      url,
      order,
    },
  });

  revalidatePath(`/courses/${programId}`);
  return material;
}

export async function deleteProgramMaterial(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  const material = await prisma.programMaterial.delete({ where: { id } });
  revalidatePath(`/courses/${material.programId}`);
  return material;
}

export async function updateModule(
  id: string,
  data: { name?: string; description?: string; programId?: string }
) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  // If programId is changing, we need to recalculate order
  if (data.programId) {
    const current = await prisma.module.findUnique({ where: { id } });
    if (!current) throw new Error("Module not found");

    if (current.programId !== data.programId) {
      console.log(
        `[updateModule] Moving module ${id} from program ${current.programId} to ${data.programId}`
      );

      // Count modules in target program to place at the end
      const targetCount = await prisma.module.count({
        where: { programId: data.programId },
      });

      const { programId: newProgramId, ...restData } = data;

      const module = await prisma.module.update({
        where: { id },
        data: {
          ...restData,
          order: targetCount,
          updatedAt: new Date(),
          program: {
            connect: { id: newProgramId },
          },
        },
      });

      // Touch new program updatedAt
      await prisma.program.update({
        where: { id: newProgramId },
        data: { updatedAt: new Date() },
      });

      // Reindex old program's modules
      const remaining = await prisma.module.findMany({
        where: { programId: current.programId },
        orderBy: { order: "asc" },
      });
      await Promise.all(
        remaining.map((m, i) =>
          prisma.module.update({ where: { id: m.id }, data: { order: i } })
        )
      );
      // Touch old program updatedAt
      await prisma.program.update({
        where: { id: current.programId },
        data: { updatedAt: new Date() },
      });

      console.log(
        `[updateModule] Module ${id} moved successfully, order=${targetCount}`
      );

      revalidatePath(`/courses/${current.programId}`);
      revalidatePath(`/courses/${data.programId}`);
      return module;
    }
  }

  const module = await prisma.module.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  });
  revalidatePath(`/courses/${module.programId}`);
  return module;
}

export async function deleteModule(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  // Collect all GCS assets from nested lessons before deletion
  const module = await prisma.module.findUnique({
    where: { id },
    select: {
      programId: true,
      lessons: {
        select: {
          id: true,
          videoUrl: true,
          posterUrl: true,
          audioUrl: true,
          captionsUrl: true,
          dataUrl: true,
        },
      },
    },
  });
  if (!module) throw new Error("Module not found");

  await prisma.module.delete({ where: { id } });
  console.log(`[deleteModule] Deleted module ${id} from DB (${module.lessons.length} lessons)`);

  // Clean up GCS assets for all lessons in the module
  const gcsKeys = module.lessons.flatMap((l) =>
    [l.videoUrl, l.posterUrl, l.audioUrl, l.captionsUrl, l.dataUrl].filter((v): v is string => !!v)
  );

  if (gcsKeys.length > 0) {
    console.log(`[deleteModule] Cleaning ${gcsKeys.length} GCS asset(s) for module ${id}`);
    await Promise.all(gcsKeys.map((url) => deleteFromGCS(url)));
  }

  revalidatePath(`/courses/${module.programId}`);
}

export async function createLesson(moduleId: string, data: { name: string; duration: number; type: string; text?: string; videoUrl?: string }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const lastLesson = await prisma.lesson.findFirst({ where: { moduleId }, orderBy: { order: "desc" }});
  const order = lastLesson ? lastLesson.order + 1 : 0;

  const lesson = await prisma.lesson.create({
    data: {
      moduleId,
      name: data.name,
      duration: data.duration,
      type: data.type,
      text: data.text,
      videoUrl: data.videoUrl,
      order,
    },
  });
  const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { programId: true } });
  if (mod) revalidatePath(`/courses/${mod.programId}`);
  return lesson;
}

export async function updateLesson(id: string, data: { name?: string; duration?: number; type?: string; text?: string; videoUrl?: string; posterUrl?: string; intro?: string; timecodes?: string; tags?: string }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const lesson = await prisma.lesson.update({
    where: { id },
    data,
  });
  const mod = await prisma.module.findUnique({ where: { id: lesson.moduleId }, select: { programId: true } });
  if (mod) revalidatePath(`/courses/${mod.programId}`);
  return lesson;
}

export async function deleteLesson(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  // Fetch all GCS-stored fields before deletion
  const lesson = await prisma.lesson.findUnique({
    where: { id },
    select: {
      moduleId: true,
      videoUrl: true,
      posterUrl: true,
      audioUrl: true,
      captionsUrl: true,
      dataUrl: true,
    },
  });
  if (!lesson) throw new Error("Lesson not found");

  await prisma.lesson.delete({ where: { id } });
  console.log(`[deleteLesson] Deleted lesson ${id} from DB`);

  // Clean up GCS assets
  const gcsFields = [lesson.videoUrl, lesson.posterUrl, lesson.audioUrl, lesson.captionsUrl, lesson.dataUrl];
  const toDelete = gcsFields.filter((v): v is string => !!v);

  if (toDelete.length > 0) {
    console.log(`[deleteLesson] Cleaning ${toDelete.length} GCS asset(s) for lesson ${id}`);
    await Promise.all(toDelete.map((url) => deleteFromGCS(url)));
  }

  const mod = await prisma.module.findUnique({
    where: { id: lesson.moduleId },
    select: { programId: true },
  });
  if (mod) revalidatePath(`/courses/${mod.programId}`);
}

export async function createAssessment(moduleId: string, data: { name: string }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const lastAss = await prisma.assessment.findFirst({ where: { moduleId }, orderBy: { order: "desc" }});
  const order = lastAss ? lastAss.order + 1 : 0;

  const assessment = await prisma.assessment.create({
    data: {
      moduleId,
      name: data.name,
      order,
    },
  });
  const mod = await prisma.module.findUnique({ where: { id: moduleId }, select: { programId: true } });
  if (mod) revalidatePath(`/courses/${mod.programId}`);
  return assessment;
}

export async function updateAssessment(id: string, data: { name?: string }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const assessment = await prisma.assessment.update({
    where: { id },
    data,
  });
  const mod = await prisma.module.findUnique({ where: { id: assessment.moduleId }, select: { programId: true } });
  if (mod) revalidatePath(`/courses/${mod.programId}`);
  return assessment;
}

export async function deleteAssessment(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const assessment = await prisma.assessment.delete({ where: { id } });
  const mod = await prisma.module.findUnique({ where: { id: assessment.moduleId }, select: { programId: true } });
  if (mod) revalidatePath(`/courses/${mod.programId}`);
}

export async function createAssessmentItem(assessmentId: string, data: { title?: string; questionText: string; type: string }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const lastItem = await prisma.assessmentItem.findFirst({ where: { assessmentId }, orderBy: { order: "desc" }});
  const order = lastItem ? lastItem.order + 1 : 0;

  const item = await prisma.assessmentItem.create({
    data: {
      assessmentId,
      title: data.title,
      questionText: data.questionText,
      type: data.type,
      order,
    },
  });
  const ass = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { module: { select: { programId: true } } } });
  if (ass) revalidatePath(`/courses/${ass.module.programId}`);
  return item;
}

export async function createAssessmentOption(itemId: string, data: { text: string; isCorrect: boolean }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const lastOpt = await prisma.assessmentOption.findFirst({ where: { itemId }, orderBy: { order: "desc" }});
  const order = lastOpt ? lastOpt.order + 1 : 0;

  const option = await prisma.assessmentOption.create({
    data: {
      itemId,
      text: data.text,
      isCorrect: data.isCorrect,
      order,
    },
  });
  return option;
}

export async function updateAssessmentItem(id: string, data: { title?: string; questionText?: string; type?: string }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const item = await prisma.assessmentItem.update({
    where: { id },
    data,
  });
  return item;
}

export async function deleteAssessmentItem(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  await prisma.assessmentItem.delete({ where: { id } });
}

export async function updateAssessmentOption(id: string, data: { text?: string; isCorrect?: boolean }) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const option = await prisma.assessmentOption.update({
    where: { id },
    data,
  });
  return option;
}

export async function deleteAssessmentOption(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  await prisma.assessmentOption.delete({ where: { id } });
}

export async function updateAssessmentItemsOrder(items: { id: string; order: number }[]) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  await Promise.all(
    items.map((item) =>
      prisma.assessmentItem.update({
        where: { id: item.id },
        data: { order: item.order },
      })
    )
  );
}

export async function getAssessment(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  return prisma.assessment.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { order: "asc" },
        include: {
          options: {
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });
}

export async function getPrograms() {
  return prisma.program.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function submitAssessment(assessmentId: string, cohortId: string | undefined, answers: any[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const userId = (session.user as any).id;

  const submission = await (prisma as any).assessmentSubmission.create({
    data: {
      assessmentId,
      userId,
      ...(cohortId ? { cohortId } : {}),
      status: "submitted",
    },
  });

  let autoTotal = 0;
  for (const ans of answers) {
    const item = await prisma.assessmentItem.findUnique({
      where: { id: ans.itemId },
      include: { options: true },
    });
    if (!item) continue;

    const answer = await (prisma as any).assessmentAnswer.create({
      data: {
        submissionId: submission.id,
        itemId: ans.itemId,
        textAnswer: ans.textAnswer,
      },
    });

    if (item.type !== "free_text" && ans.selectedOptionIds) {
      await Promise.all(
        ans.selectedOptionIds.map((optId: string) =>
            (prisma as any).selectedOption.create({
            data: {
              answerId: answer.id,
              optionId: optId,
            },
          })
        )
      );

      if (item.type === "single_choice") {
        const correct = item.options.find(o => o.isCorrect);
        if (correct && correct.id === ans.selectedOptionIds[0]) {
          await (prisma as any).assessmentAnswer.update({ where: { id: answer.id }, data: { points: 1 } });
          autoTotal += 1;
        }
      } else if (item.type === "multiple_choice") {
        const correctIds = item.options.filter(o => o.isCorrect).map(o => o.id);
        const match = correctIds.length === ans.selectedOptionIds.length && correctIds.every(id => ans.selectedOptionIds.includes(id));
        if (match) {
          await (prisma as any).assessmentAnswer.update({ where: { id: answer.id }, data: { points: 1 } });
          autoTotal += 1;
        }
      }
    }
  }

  const hasFreeText = await prisma.assessmentItem.findFirst({ where: { assessmentId, type: "free_text" } });
  if (!hasFreeText) {
    await (prisma as any).assessmentSubmission.update({
      where: { id: submission.id },
      data: { totalScore: autoTotal, status: "graded" }
    });
  }

  return submission;
}

export async function getSubmission(id: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  return (prisma as any).assessmentSubmission.findUnique({
    where: { id },
    include: {
      user: true,
      assessment: true,
      answers: {
        include: {
          item: { include: { options: true } },
          selectedOptions: { include: { option: true } },
        }
      }
    }
  });
}

export async function getSubmissions(assessmentId: string, cohortId: string) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  return (prisma as any).assessmentSubmission.findMany({
    where: { assessmentId, cohortId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function gradeAnswer(answerId: string, points: number) {
  if (!(await isAuthorized())) throw new Error("Unauthorized");
  const answer = await (prisma as any).assessmentAnswer.update({
    where: { id: answerId },
    data: { points },
  });

  // Recalculate total score for submission
  const sub = await (prisma as any).assessmentSubmission.findUnique({
    where: { id: answer.submissionId },
    include: { answers: true, assessment: { include: { items: true } } }
  });

  if (sub) {
    const total = sub.answers.reduce((sum: number, a: { points: number | null }) => sum + (a.points || 0), 0);
    const allGraded = sub.answers.every((a: { points: number | null }) => a.points !== null);
    await (prisma as any).assessmentSubmission.update({
      where: { id: sub.id },
      data: { 
        totalScore: total,
        status: allGraded ? "graded" : "submitted"
      }
    });
  }
}

// --- n8n Webhook ---

export async function triggerN8nWebhook(payload: N8nWebhookPayload): Promise<void> {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("N8N_WEBHOOK_URL is not configured");

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n webhook failed: ${response.status} — ${text}`);
  }
}

// ─── Regenerate Quiz from dataUrl ─────────────────────────────────────────────

export async function regenerateLessonQuiz(lessonId: string, dataUrl?: string): Promise<{ success: boolean; questionsCount: number }> {
  if (!(await isAuthorized())) throw new Error("Unauthorized");

  // 1. Load the lesson and its current dataUrl
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, name: true, dataUrl: true },
  });

  if (!lesson) throw new Error("Lesson not found");
  const effectiveDataUrl = dataUrl || lesson.dataUrl;
  if (!effectiveDataUrl) throw new Error("dataUrl is not set for this lesson");

  // 2. Fetch the JSON at dataUrl
  // Google Drive links go through the service account
  let response: Response;
  const driveFileId = extractDriveFileId(effectiveDataUrl);
  if (driveFileId) {
    const accessToken = await getDriveAccessToken();
    response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } else {
    response = await fetch(effectiveDataUrl);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch data file: ${response.status} ${response.statusText}`);
  }

    // DEBUG: log the raw response
  const rawText = await response.text();
  console.log("[regenerateLessonQuiz] status:", response.status);
  console.log("[regenerateLessonQuiz] content-type:", response.headers.get("content-type"));
  console.log("[regenerateLessonQuiz] raw (first 300 chars):", rawText.slice(0, 300));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error("Data file contains invalid JSON");
  }

  // The Drive file is an array [{ ...jsonData }]; take the first element
  const jsonData: import("@/types/n8n").N8nLessonJsonData = Array.isArray(raw) ? raw[0] : raw;

  // 3. Validate that quiz_questions is present
  if (!jsonData || !Array.isArray(jsonData.quiz_questions)) {
    throw new Error("Data file does not contain quiz_questions array");
  }

  // 4. Delete the old quiz (QuizItem and QuizOption cascade)
  await prisma.quiz.deleteMany({ where: { lessonId } });

  // 5. No questions: return success
  if (jsonData.quiz_questions.length === 0) {
    return { success: true, questionsCount: 0 };
  }

  // 6. Create the new quiz with questions and options in a transaction
  await prisma.$transaction(async (tx) => {
    await buildQuizInTransaction(
      tx,
      lessonId,
      jsonData.lesson_title || lesson.name,
      jsonData.quiz_questions
    );
  });

  return { success: true, questionsCount: jsonData.quiz_questions.length };
}
