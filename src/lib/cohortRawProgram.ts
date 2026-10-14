// src/lib/cohortRawProgram.ts
//
// Decision logic for (re)attaching a cohort's raw recordings Program on update.
// Cohort.rawProgramId is where syncRecordingsToProgram() imports Zoom MP4s; only
// cohort creation used to set it, so a cohort created without one could never
// import recordings. Kept Prisma-free (db is injected) so it is unit-testable.

import { hasAnyRole, type RoleSource } from "@/lib/roles";

/** Roles allowed to change rawProgramId. Deliberately narrower than MANAGE_ROLES:
 *  an instructor-only user must not re-point recordings into another Program. */
export const RAW_PROGRAM_ROLES = ["ADMIN", "TEAM_MEMBER"] as const;

export type RawProgramDb = {
  program: {
    findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  cohort: {
    findFirst(args: {
      where: { rawProgramId: string; NOT: { id: string } };
      select: { id: true; title: true };
    }): Promise<{ id: string; title: string } | null>;
  };
};

export type RawProgramUpdate =
  | {
      ok: true;
      /** undefined = leave untouched, null = clear, string = set. */
      rawProgramId: string | null | undefined;
      /** Program to add to the cohort's `programs` relation, if any. */
      connectProgramId: string | null;
    }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export function canSetRawProgram(user: RoleSource): boolean {
  return hasAnyRole(user, RAW_PROGRAM_ROLES);
}

export async function resolveRawProgramUpdate(
  db: RawProgramDb,
  args: { cohortId: string; input: unknown; user: RoleSource },
): Promise<RawProgramUpdate> {
  const { cohortId, input, user } = args;
  if (input === undefined) return { ok: true, rawProgramId: undefined, connectProgramId: null };

  if (!canSetRawProgram(user)) {
    return { ok: false, status: 403, error: "Only admins and team members can change a cohort's raw recordings program" };
  }

  if (input === null) return { ok: true, rawProgramId: null, connectProgramId: null };

  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, status: 400, error: "rawProgramId must be a non-empty string or null" };
  }
  const programId = input.trim();

  const program = await db.program.findUnique({ where: { id: programId }, select: { id: true } });
  if (!program) {
    return { ok: false, status: 404, error: `Program ${programId} not found` };
  }

  const owner = await db.cohort.findFirst({
    where: { rawProgramId: programId, NOT: { id: cohortId } },
    select: { id: true, title: true },
  });
  if (owner) {
    return {
      ok: false,
      status: 409,
      error: `Program ${programId} is already the raw recordings program of cohort "${owner.title}" (${owner.id}). Detach it there first.`,
    };
  }

  return { ok: true, rawProgramId: programId, connectProgramId: programId };
}

/** Prisma `programs` relation payload for a cohort update. An explicit programIds list
 *  replaces the relation, so the raw program is appended to it rather than connected
 *  separately (mixing `set` and `connect` has no guaranteed order). */
export function buildProgramsRelation(
  programIds: string[] | undefined,
  connectProgramId: string | null,
): { set: { id: string }[] } | { connect: { id: string }[] } | undefined {
  if (programIds !== undefined) {
    const ids = connectProgramId && !programIds.includes(connectProgramId) ? [...programIds, connectProgramId] : programIds;
    return { set: ids.map((id) => ({ id })) };
  }
  return connectProgramId ? { connect: [{ id: connectProgramId }] } : undefined;
}
