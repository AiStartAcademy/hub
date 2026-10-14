import type { N8nQuizQuestion } from "@/types/n8n";
import type { Prisma } from "@/generated/client";
import { logger } from "./logger";

/** Converts letter "A" → 0, "B" → 1, "C" → 2, "D" → 3 */
export function letterToIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 65;
}

/** Strips "A) ", "B) " etc. prefixes from option text */
export function stripOptionPrefix(opt: string): string {
  return opt.replace(/^[A-D]\)\s*/i, "").trim();
}

/**
 * Determines the correct option index from a quiz question.
 * Supports two formats:
 * - Single letter: "A", "B", "C", "D"
 * - Full text match against stripped options
 */
export function parseCorrectIndex(
  q: N8nQuizQuestion,
  strippedOptions: string[]
): number {
  const answer = q.correct_answer.trim();

  if (/^[A-D]$/i.test(answer)) {
    return letterToIndex(answer);
  }

  // Fallback: match by full answer text
  return strippedOptions.findIndex(
    (opt) => opt.toLowerCase() === answer.toLowerCase()
  );
}

type TxClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Creates Quiz + QuizItems + QuizOptions inside an existing Prisma transaction.
 * No-op if questions array is empty.
 * Throws if correct_answer cannot be resolved to a valid option index.
 */
export async function buildQuizInTransaction(
  tx: TxClient,
  lessonId: string,
  lessonName: string,
  questions: N8nQuizQuestion[]
): Promise<void> {
  if (questions.length === 0) {
    logger.info(`[buildQuiz] No questions for lesson "${lessonName}", skipping`);
    return;
  }

  const quiz = await tx.quiz.create({
    data: {
      lessonId,
      name: `Quiz: ${lessonName}`,
    },
  });

  logger.info(`[buildQuiz] Created quiz ${quiz.id} for lesson "${lessonName}" (${questions.length} questions)`);

  for (let qIndex = 0; qIndex < questions.length; qIndex++) {
    const q = questions[qIndex];
    const strippedOptions = q.options.map(stripOptionPrefix);
    const correctIndex = parseCorrectIndex(q, strippedOptions);

    if (correctIndex === -1) {
      throw new Error(
        `[buildQuiz] No matching option for correct_answer: "${q.correct_answer}" in question: "${q.question}"`
      );
    }

    const quizItem = await tx.quizItem.create({
      data: {
        quizId: quiz.id,
        questionText: q.question,
        type: "single_choice",
        order: qIndex,
      },
    });

    await tx.quizOption.createMany({
      data: strippedOptions.map((text, oIndex) => ({
        itemId: quizItem.id,
        text,
        isCorrect: oIndex === correctIndex,
        order: oIndex,
      })),
    });
  }
}