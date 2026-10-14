/**
 * MCP surface for the lesson-library backfill (see ../../../../../../../Plans/lesson-library-plan.md).
 *
 * GET  — lists raw Zoom-synced lessons missing content (tags empty) by default, or
 *        lessons missing a poster when called with ?missing=poster.
 * PATCH — writes intro/text/tags/timecodes/name onto an EXISTING Lesson row, matched by
 *        zoomFileId. No new schema: this fills columns syncRecordingsToProgram() already
 *        created empty. Per-item guard refuses to overwrite a lesson that already has
 *        non-empty tags unless force:true — the whole point is to protect the 58 lessons
 *        n8n already enriched from being silently clobbered by a re-run. A write landing
 *        only in still-empty columns (the poster sweep filling posterUrl) is exempt: it
 *        replaces nothing, so it needs no force.
 */
import prisma from "@/lib/prisma";
import {
  mcpError,
  mcpJson,
  mcpJsonLimited,
  mcpWritesEnabled,
  requireMcpToken,
  MCP_LIST_MAX_BYTES,
} from "@/lib/mcpApi";
import {
  buildLessonListWhere,
  deriveHasContent,
  fillsOnlyEmptyFields,
  parseMissingFilter,
  type MissingLessonField,
} from "@/lib/lessonContentQuery";
import { logger } from "@/lib/logger";
import { buildQuizInTransaction } from "@/lib/quizUtils";

export const dynamic = "force-dynamic";

const WRITES_DISABLED_MESSAGE =
  "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true').";

const CONTENT_FIELDS = [
  "name",
  "intro",
  "text",
  "tags",
  "timecodes",
  "posterUrl",
  "audioUrl",
  "captionsUrl",
] as const;
type ContentField = (typeof CONTENT_FIELDS)[number];
const URL_FIELDS = ["posterUrl", "audioUrl", "captionsUrl"] as const;
type UrlField = (typeof URL_FIELDS)[number];
const QUIZ_CHANGED_FIELD = "quiz" as const;
type ChangedField = ContentField | typeof QUIZ_CHANGED_FIELD;
const ALLOWED_ITEM_KEYS = [...CONTENT_FIELDS, "zoomFileId", "lessonId", "force", "quizQuestions"] as const;
type AllowedItemKey = (typeof ALLOWED_ITEM_KEYS)[number];
interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
}

interface ContentItem {
  zoomFileId?: unknown;
  lessonId?: unknown;
  name?: unknown;
  intro?: unknown;
  text?: unknown;
  tags?: unknown;
  timecodes?: unknown;
  posterUrl?: unknown;
  audioUrl?: unknown;
  captionsUrl?: unknown;
  quizQuestions?: unknown;
  force?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseHttpsUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Error(`${field} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${field} must use https`);
  }
  return parsed.toString();
}

function isUrlField(field: ContentField): field is UrlField {
  return URL_FIELDS.includes(field as UrlField);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function parseQuizQuestions(value: unknown, itemIndex: number): QuizQuestion[] {
  const field = `items[${itemIndex}].quizQuestions`;
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length < 1 || value.length > 20) {
    throw new Error(`${field} must contain between 1 and 20 questions`);
  }

  return value.map((question, questionIndex) => {
    const questionField = `${field}[${questionIndex}]`;
    if (!isRecord(question)) {
      throw new Error(`${questionField} must be an object`);
    }

    const prompt = requireNonEmptyString(question.question, `${questionField}.question`);
    if (!Array.isArray(question.options)) {
      throw new Error(`${questionField}.options must be an array`);
    }
    if (question.options.length < 2 || question.options.length > 6) {
      throw new Error(`${questionField}.options must contain between 2 and 6 options`);
    }

    const options = question.options.map((option, optionIndex) =>
      requireNonEmptyString(option, `${questionField}.options[${optionIndex}]`)
    );

    if (typeof question.correct_answer !== "string") {
      throw new Error(`${questionField}.correct_answer must be a string`);
    }
    if (!options.includes(question.correct_answer)) {
      throw new Error(`${questionField}.correct_answer must exactly match one of its options`);
    }
    if ("explanation" in question && question.explanation !== undefined && typeof question.explanation !== "string") {
      throw new Error(`${questionField}.explanation must be a string when provided`);
    }

    return {
      question: prompt,
      options,
      correct_answer: question.correct_answer,
      ...(typeof question.explanation === "string" ? { explanation: question.explanation } : {}),
    };
  });
}

function formatQuizChange(questionCount: number): string {
  return `quiz(${questionCount} questions)`;
}

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  let missing: MissingLessonField;
  try {
    missing = parseMissingFilter(new URL(req.url).searchParams.get("missing"));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mcpJson({ error: error.message }, 400);
  }

  const lessons = await prisma.lesson.findMany({
    where: buildLessonListWhere(missing),
    select: {
      id: true,
      name: true,
      zoomFileId: true,
      duration: true,
      tags: true,
      moduleId: true,
      module: { select: { name: true, program: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  const items = lessons.map((l) => ({
    lessonId: l.id,
    zoomFileId: l.zoomFileId,
    name: l.name,
    durationSec: l.duration,
    moduleName: l.module.name,
    programId: l.module.program.id,
    programName: l.module.program.name,
    hasContent: deriveHasContent(l.tags),
  }));

  return mcpJsonLimited({ items, total: items.length }, MCP_LIST_MAX_BYTES);
}

export async function PATCH(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpJson({ error: WRITES_DISABLED_MESSAGE }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mcpError("Invalid JSON", 400);
  }
  if (!isRecord(body) || !Array.isArray(body.items) || body.items.length === 0) {
    return mcpError("Expected a JSON body with a non-empty items array", 400);
  }
  if (body.items.length > 50) {
    return mcpError("At most 50 items per call", 400);
  }

  const items = body.items as ContentItem[];
  const quizQuestionsByItemIndex = new Map<number, QuizQuestion[]>();

  for (const [itemIndex, item] of items.entries()) {
    if (!isRecord(item)) return mcpError(`items[${itemIndex}] must be an object`, 400);
    const hasZoomFileId = typeof item.zoomFileId === "string" && item.zoomFileId.trim().length > 0;
    const hasLessonId = typeof item.lessonId === "string" && item.lessonId.trim().length > 0;
    if (Number(hasZoomFileId) + Number(hasLessonId) !== 1) {
      return mcpError(`items[${itemIndex}] needs exactly one of zoomFileId or lessonId`, 400);
    }
    for (const key of Object.keys(item)) {
      if (!ALLOWED_ITEM_KEYS.includes(key as AllowedItemKey)) {
        return mcpError(`items[${itemIndex}] rejected key: ${key}`, 400);
      }
    }
    for (const field of CONTENT_FIELDS) {
      if (field in item && typeof item[field] !== "string") {
        return mcpError(`items[${itemIndex}].${field} must be a string`, 400);
      }
    }
    for (const field of URL_FIELDS) {
      if (field in item && typeof item[field] === "string") {
        try {
          parseHttpsUrl(item[field], `items[${itemIndex}].${field}`);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          return mcpError(error.message, 400);
        }
      }
    }
    if ("quizQuestions" in item) {
      try {
        quizQuestionsByItemIndex.set(itemIndex, parseQuizQuestions(item.quizQuestions, itemIndex));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return mcpError(error.message, 400);
      }
    }
  }

  try {
    const results: Array<{
      lessonId: string;
      zoomFileId: string | null;
      changed: Partial<Record<ChangedField, { from: string | null; to: string }>>;
      changedFields: string[];
      unchanged: ContentField[];
      refused?: string;
    }> = [];

    await prisma.$transaction(async (tx) => {
      for (const [itemIndex, item] of items.entries()) {
        const where = item.lessonId
          ? { id: item.lessonId as string }
          : { zoomFileId: item.zoomFileId as string };

        const lesson = await tx.lesson.findUnique({
          where,
          select: {
            id: true,
            zoomFileId: true,
            name: true,
            intro: true,
            text: true,
            tags: true,
            timecodes: true,
            posterUrl: true,
            audioUrl: true,
            captionsUrl: true,
            quiz: { select: { _count: { select: { items: true } } } },
          },
        });
        if (!lesson) {
          results.push({
            lessonId: (item.lessonId as string) ?? "",
            zoomFileId: (item.zoomFileId as string) ?? null,
            changed: {},
            changedFields: [],
            unchanged: [],
            refused: "Lesson not found",
          });
          continue;
        }

        const incoming: Partial<Record<ContentField, string>> = {};
        const currentFields: Partial<Record<ContentField, string | null>> = {};
        for (const field of CONTENT_FIELDS) {
          currentFields[field] = lesson[field];
          if (field in item) incoming[field] = item[field] as string;
        }
        const additiveOnly =
          !quizQuestionsByItemIndex.has(itemIndex) && fillsOnlyEmptyFields(incoming, currentFields);

        const alreadyEnriched = !!(lesson.tags && lesson.tags.trim());
        if (alreadyEnriched && item.force !== true && !additiveOnly) {
          results.push({
            lessonId: lesson.id,
            zoomFileId: lesson.zoomFileId,
            changed: {},
            changedFields: [],
            unchanged: [],
            refused: "Lesson already has content (tags is non-empty). Pass force:true to overwrite.",
          });
          continue;
        }

        const changed: Partial<Record<ChangedField, { from: string | null; to: string }>> = {};
        const unchanged: ContentField[] = [];
        const data: Partial<Record<ContentField, string>> = {};

        for (const field of CONTENT_FIELDS) {
          if (!(field in item)) continue;
          const nextValue =
            isUrlField(field)
              ? parseHttpsUrl(item[field] as string, field)
              : (item[field] as string);
          const currentValue = lesson[field];
          if (currentValue === nextValue) {
            unchanged.push(field);
          } else {
            changed[field] = { from: currentValue, to: nextValue };
            data[field] = nextValue;
          }
        }

        if (Object.keys(data).length > 0) {
          await tx.lesson.update({ where: { id: lesson.id }, data });
        }

        const quizQuestions = quizQuestionsByItemIndex.get(itemIndex);
        if (quizQuestions) {
          await tx.quiz.deleteMany({ where: { lessonId: lesson.id } });
          await buildQuizInTransaction(
            tx as Parameters<typeof buildQuizInTransaction>[0],
            lesson.id,
            data.name ?? lesson.name,
            quizQuestions as Parameters<typeof buildQuizInTransaction>[3]
          );
          changed[QUIZ_CHANGED_FIELD] = {
            from: lesson.quiz ? formatQuizChange(lesson.quiz._count.items) : null,
            to: formatQuizChange(quizQuestions.length),
          };
        }

        const changedFields = Object.entries(changed).map(([field, value]) =>
          field === QUIZ_CHANGED_FIELD ? value.to : field
        );

        results.push({ lessonId: lesson.id, zoomFileId: lesson.zoomFileId, changed, changedFields, unchanged });
      }
    });

    console.info("[mcp-audit] lesson_content_update", {
      actor: "mcp",
      count: results.length,
      written: results.filter((r) => !r.refused).length,
      refused: results.filter((r) => r.refused).length,
    });

    return mcpJson({ items: results });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] lesson content update failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Lesson content update failed", correlationId }, 500);
  }
}
