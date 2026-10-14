import type { Prisma } from "@/generated/client";

export type MissingLessonField = "content" | "poster";

const MISSING_FILTER_ERROR =
  'missing must be one of: "poster", "content"';

export function parseMissingFilter(raw: string | null): MissingLessonField {
  if (raw === null || raw === "content") return "content";
  if (raw === "poster") return "poster";
  throw new Error(MISSING_FILTER_ERROR);
}

export function buildLessonListWhere(
  missing: MissingLessonField
): Prisma.LessonWhereInput {
  return {
    zoomFileId: { not: null },
    OR:
      missing === "poster"
        ? [{ posterUrl: null }, { posterUrl: "" }]
        : [{ tags: null }, { tags: "" }],
  };
}

export function deriveHasContent(tags: string | null): boolean {
  return Boolean(tags?.trim());
}

/**
 * The enrichment guard exists to stop a backfill re-run from clobbering lessons
 * a human already enriched — so it only needs to fire on writes that would
 * replace an existing value. A write landing solely in columns that are still
 * empty (the poster sweep filling posterUrl) destroys nothing and needs no force.
 */
export function fillsOnlyEmptyFields(
  incoming: Partial<Record<string, string>>,
  current: Partial<Record<string, string | null>>
): boolean {
  const fields = Object.keys(incoming);
  if (fields.length === 0) return false;
  return fields.every((field) => !current[field]?.trim());
}
