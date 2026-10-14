import prisma from "@/lib/prisma";

/**
 * True when `input` contains at least one character `slugify` will keep.
 *
 * Check this before slugifying anything that is NOT a cohort: `slugify` falls back to
 * the literal "cohort" when nothing survives the strip, which is right for cohorts and
 * absurd for a person — a Cyrillic-only name would publish someone at /humans/cohort.
 */
export function hasSlugSafeChars(input: string): boolean {
  return /[a-z0-9]/i.test(input);
}

/** Turn a title into an ASCII, URL-safe slug. Falls back to "cohort" if empty. */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "")
      .slice(0, 80) || "cohort"
  );
}

/**
 * A cohort slug guaranteed unique across the table. Appends -2, -3, … on collision.
 * Pass `excludeId` when updating so a cohort doesn't collide with its own slug.
 */
export async function uniqueCohortSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  // Bounded loop — realistically resolves in one or two iterations.
  while (n < 1000) {
    const clash = await prisma.cohort.findFirst({
      where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}

/**
 * A user slug guaranteed unique across the table (public /humans/{slug}).
 * Appends -2, -3, … on collision. Pass `excludeId` when updating so a user
 * doesn't collide with their own slug.
 */
export async function uniqueUserSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  // Bounded loop — realistically resolves in one or two iterations.
  while (n < 1000) {
    const clash = await prisma.user.findFirst({
      where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
  return `${root}-${Date.now()}`;
}
