import type { Prisma } from "@/generated/client";
import prisma from "@/lib/prisma";
import { uniqueCohortSlug } from "@/lib/slug";
import {
  createZoomMeeting as createZoomMeetingReal,
  syncCohortSessions as syncCohortSessionsReal,
  type CreateZoomMeetingInput,
} from "@/lib/zoom";
import { getSecret as getSecretReal } from "@/lib/secrets";
import { logger } from "@/lib/logger";
import { syncCohortInstructors as syncCohortInstructorsReal } from "@/lib/instructorParticipation";

/**
 * Cohort creation is split at the request/DB boundary on purpose. Route-level
 * 400s mean the caller sent a malformed request; errors here mean a normalized
 * request refers to records that do not exist in the database. This lets
 * non-HTTP callers such as the Monday roll reuse all database work without
 * reimplementing HTTP parsing and coercion.
 */

export class CohortCreateError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CohortCreateError";
    this.status = status;
  }
}

export interface CohortCreateGroupInput {
  name: string;
  price: number;
  seats?: number;
  inPerson: boolean;
}

export interface CohortCreateInput {
  title: string;
  slug?: string;
  description?: string | null;
  status?: string;
  deliveryMode: "ONLINE" | "INPERSON" | "HYBRID";
  location?: string | null;
  zoomLink?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  instructorEmails?: string[];
  programTitles?: string[];
  rawProgramTitle?: string | null;
  groups: CohortCreateGroupInput[];
  requireGroups?: boolean;
  /** Fully validated Zoom input; HTTP parsing and time-order checks stay in the route. */
  zoomMeeting?: CreateZoomMeetingInput | null;
}

const COHORT_INCLUDE = {
  groups: true,
  instructors: { select: { id: true, name: true, email: true } },
  programs: { select: { id: true, name: true } },
  rawProgram: { select: { id: true, name: true } },
} satisfies Prisma.CohortInclude;

export type CreatedCohort = Prisma.CohortGetPayload<{
  include: typeof COHORT_INCLUDE;
}>;

export interface CohortCreateResult {
  cohort: CreatedCohort;
  slug: string;
  zoomWarning: string | null;
  sessionsCreated: number | null;
  sessionsNote: string | null;
}

export interface CohortCreateDeps {
  db?: typeof prisma;
  createZoomMeeting?: typeof createZoomMeetingReal;
  syncCohortSessions?: typeof syncCohortSessionsReal;
  syncCohortInstructors?: typeof syncCohortInstructorsReal;
  getSecret?: typeof getSecretReal;
}

export async function createCohort(
  input: CohortCreateInput,
  deps: CohortCreateDeps = {}
): Promise<CohortCreateResult> {
  const db = deps.db ?? prisma;
  const createZoomMeeting = deps.createZoomMeeting ?? createZoomMeetingReal;
  const syncCohortSessions = deps.syncCohortSessions ?? syncCohortSessionsReal;
  const syncCohortInstructors =
    deps.syncCohortInstructors ?? syncCohortInstructorsReal;
  const getSecret = deps.getSecret ?? getSecretReal;
  const instructorEmails = input.instructorEmails ?? [];
  const explicitProgramTitles = input.programTitles ?? [];

  if ((input.requireGroups ?? false) && input.groups.length === 0) {
    throw new CohortCreateError("At least one group is required");
  }

  // Unknown instructors are a hard error rather than a silent partial attach.
  let instructorIds: string[] = [];
  if (instructorEmails.length) {
    const users = await db.user.findMany({
      where: { email: { in: instructorEmails } },
      select: { id: true, email: true },
    });
    const found = new Set(users.map((user) => user.email));
    const missing = instructorEmails.filter((email) => !found.has(email));
    if (missing.length) {
      throw new CohortCreateError(
        `instructorEmails not found as existing Users: ${missing.join(", ")}`
      );
    }
    instructorIds = users.map((user) => user.id);
  }

  // Admin-configured defaults are merged with explicit programs for every caller.
  const defaultProgramTitlesRaw =
    (await getSecret("COHORT_DEFAULT_PROGRAM_TITLES")) ?? "";
  const defaultProgramTitles = defaultProgramTitlesRaw
    .split(",")
    .map((title) => title.trim())
    .filter(Boolean);
  const programTitles = Array.from(
    new Set([...defaultProgramTitles, ...explicitProgramTitles])
  );
  let programIds: string[] = [];
  if (programTitles.length) {
    const programs = await db.program.findMany({
      where: { name: { in: programTitles } },
      select: { id: true, name: true },
    });
    const found = new Set(programs.map((program) => program.name));
    const missing = programTitles.filter((title) => !found.has(title));
    if (missing.length) {
      throw new CohortCreateError(
        `programTitles not found as existing Programs: ${missing.join(", ")}`
      );
    }
    programIds = programs.map((program) => program.id);
  }

  // The recording-import target is a one-to-one relationship with a Program.
  let rawProgramId: string | undefined;
  const rawProgramTitle = input.rawProgramTitle?.trim() ?? "";
  if (rawProgramTitle) {
    const program = await db.program.findFirst({
      where: { name: rawProgramTitle },
    });
    if (!program) {
      throw new CohortCreateError(
        `rawProgramTitle not found as an existing Program: ${rawProgramTitle}`
      );
    }
    const alreadyTaken = await db.cohort.findFirst({
      where: { rawProgramId: program.id },
    });
    if (alreadyTaken) {
      throw new CohortCreateError(
        `Program "${rawProgramTitle}" is already the raw program for cohort ${alreadyTaken.id} — ` +
          "a Program can only be the recording-import target for one cohort at a time"
      );
    }
    rawProgramId = program.id;
  }

  // A supplied slug is already authoritative (the roll uses this for idempotency).
  const slug =
    input.slug !== undefined ? input.slug : await uniqueCohortSlug(input.title);
  let zoomLink = input.zoomLink ?? null;
  let zoomMeetingId: string | null = null;
  let zoomWarning: string | null = null;

  if (input.zoomMeeting) {
    try {
      const meeting = await createZoomMeeting(input.zoomMeeting);
      zoomLink = meeting.joinUrl;
      zoomMeetingId = String(meeting.id);
    } catch (error) {
      // Zoom is deliberately fail-open: retain the cohort and tell the caller what failed.
      zoomWarning = `Zoom meeting was NOT created: ${(error as Error).message}`;
      logger.error({ err: error }, "[MCP] Zoom meeting creation failed:");
    }
  }

  const status = input.status ?? "DRAFT";
  const cohort = await db.cohort.create({
    data: {
      title: input.title,
      slug,
      description: input.description ?? null,
      status,
      deliveryMode: input.deliveryMode,
      location: input.location ?? null,
      zoomLink,
      zoomMeetingId,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      timezone: input.timezone ?? undefined,
      groups: input.groups.length ? { create: input.groups } : undefined,
      instructors: instructorIds.length
        ? { connect: instructorIds.map((id) => ({ id })) }
        : undefined,
      programs: programIds.length
        ? { connect: programIds.map((id) => ({ id })) }
        : undefined,
      rawProgramId,
    },
    include: COHORT_INCLUDE,
  });

  logger.info(
    `[MCP] Created ${status} cohort ${cohort.id} (${slug}) with ${input.groups.length} group(s)`
  );

  if (instructorIds.length) {
    await syncCohortInstructors(cohort.id);
  }

  // Zoom occurrence synchronization remains best-effort after the durable create.
  let sessionsCreated: number | null = null;
  let sessionsNote: string | null = null;
  if (cohort.zoomLink) {
    try {
      sessionsCreated = await syncCohortSessions({
        id: cohort.id,
        title: cohort.title,
        zoomLink: cohort.zoomLink,
        rawProgramId: rawProgramId ?? null,
      });
      if (sessionsCreated === null) {
        sessionsNote =
          "Zoom returned no occurrences yet — sessions were not created. Re-run session sync " +
          "from the cohort's admin Sessions panel in a moment.";
      }
    } catch (error) {
      sessionsNote = `Session sync failed: ${(error as Error).message}. Re-run it from the admin Sessions panel.`;
      logger.error(
        { err: error },
        "[MCP] syncCohortSessions failed after create:"
      );
    }
  }

  return { cohort, slug, zoomWarning, sessionsCreated, sessionsNote };
}
