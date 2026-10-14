// src/app/api/quiz/[quizId]/submit/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkProgramAccess } from "@/lib/programAccess";
import { logger } from "@/lib/logger";

// Request body type
interface SubmitBody {
  // { [itemId]: string[] } — selected option IDs for single/multiple
  // { [itemId]: string }   — text answer for free_text
  answers: Record<string, string[] | string>;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quizId: string }> }
) {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { quizId } = await params;
  const body: SubmitBody = await req.json();

  logger.info(`[quiz submit] Received answers for ${Object.keys(body.answers).length} items, quizId=${quizId}`);

  // ── 1. Load quiz with questions and correct answers ──────────────────
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      // Need lesson → module → program for access check
      lesson: {
        select: {
          module: { select: { programId: true } },
        },
      },
      items: {
        include: { options: true },
      },
      submissions: {
        where: { userId },
        orderBy: { attemptNumber: "desc" },
        take: 1,
      },
    },
  });

  if (!quiz) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  // ── 2. Check program access ──────────────────────────────────────────
  const programId = quiz.lesson.module.programId;
  const { hasAccess } = await checkProgramAccess(programId, userId);

  if (!hasAccess) {
    logger.info(
      `[quiz submit] Access denied: userId=${userId} quizId=${quizId} programId=${programId}`
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  logger.info(
    `[quiz submit] userId=${userId} quizId=${quizId} programId=${programId}`
  );

  // ── 3. Check attempt limit ──────────────────────────────────────────
  const lastSubmission = quiz.submissions[0];
  const nextAttemptNumber = lastSubmission
    ? lastSubmission.attemptNumber + 1
    : 1;

  if (
    quiz.maxAttempts !== null &&
    quiz.maxAttempts !== undefined &&
    nextAttemptNumber > quiz.maxAttempts
  ) {
    return NextResponse.json(
      { error: "Max attempts reached" },
      { status: 400 }
    );
  }

  // ── 4. Calculate score for auto-gradeable questions ─────────────────
  let totalAutoItems = 0;
  let correctCount = 0;
  let hasFreeText = false;

  for (const item of quiz.items) {
    const userAnswer = body.answers[item.id];

    if (item.type === "free_text") {
      hasFreeText = true;
      continue;
    }

    totalAutoItems++;
    const correctOptionIds = item.options
      .filter((o) => o.isCorrect)
      .map((o) => o.id);
    const selectedIds = Array.isArray(userAnswer) ? userAnswer : [];

    const isCorrect =
      correctOptionIds.length === selectedIds.length &&
      correctOptionIds.every((id) => selectedIds.includes(id));

    if (isCorrect) correctCount++;
  }

  // totalScore in percent; null when there are free_text items and no auto-graded ones
  const totalScore: number | null =
    totalAutoItems > 0
      ? Math.round((correctCount / totalAutoItems) * 100)
      : null;

  // ── 5. Save submission in transaction ──────────────────────────────
  const submission = await prisma.$transaction(async (tx) => {
    const sub = await tx.quizSubmission.create({
      data: {
        quizId,
        userId,
        attemptNumber: nextAttemptNumber,
        totalScore,
        status: hasFreeText && totalAutoItems === 0 ? "submitted" : "graded",
      },
    });

    for (const item of quiz.items) {
      const userAnswer = body.answers[item.id];

      if (item.type === "free_text") {
        await tx.quizAnswer.create({
          data: {
            submissionId: sub.id,
            itemId: item.id,
            textAnswer: typeof userAnswer === "string" ? userAnswer : null,
            points: null,
          },
        });
      } else {
        const selectedIds = Array.isArray(userAnswer) ? userAnswer : [];
        const correctOptionIds = item.options
          .filter((o) => o.isCorrect)
          .map((o) => o.id);

        const isCorrect =
          correctOptionIds.length === selectedIds.length &&
          correctOptionIds.every((id) => selectedIds.includes(id));

        const answer = await tx.quizAnswer.create({
          data: {
            submissionId: sub.id,
            itemId: item.id,
            textAnswer: null,
            points: isCorrect ? 1 : 0,
          },
        });

        // Save the selected options
        if (selectedIds.length > 0) {
          await tx.quizSelectedOption.createMany({
            data: selectedIds.map((optionId) => ({
              answerId: answer.id,
              optionId,
            })),
          });
        }
      }
    }

    return sub;
  });

   // ── 6. Return result with per-question details ──────────────────────
  const result = quiz.items.map((item) => {
    const userAnswer = body.answers[item.id];
    if (item.type === "free_text") {
      return { itemId: item.id, type: "free_text", correct: null };
    }

    const correctOptionIds = item.options
      .filter((o) => o.isCorrect)
      .map((o) => o.id);
    const selectedIds = Array.isArray(userAnswer) ? userAnswer : [];
    const isCorrect =
      correctOptionIds.length === selectedIds.length &&
      correctOptionIds.every((id) => selectedIds.includes(id));

    return {
      itemId: item.id,
      type: item.type,
      correct: isCorrect,
      correctOptionIds,
      selectedOptionIds: selectedIds,
    };
  });

  return NextResponse.json({
    submissionId: submission.id,
    attemptNumber: nextAttemptNumber,
    totalScore,
    status: submission.status,
    attemptsLeft:
      quiz.maxAttempts !== null && quiz.maxAttempts !== undefined
        ? quiz.maxAttempts - nextAttemptNumber
        : null,
    result,
  });
}