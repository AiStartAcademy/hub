// MCP surface for shared session series — the daily check-in that serves every
// running day cohort at once. See src/lib/seriesAdmin.ts for the shared validation
// and prisma/schema.prisma ("Shared Session Series") for the model.
//
// Zoom provisioning is deliberately NOT exposed here, matching the cohort v1 PATCH:
// a wrong write would desync the live recurring meeting from the DB rows without
// touching the meeting itself. Provision from the admin UI.

import prisma from "@/lib/prisma";
import {
  MCP_DETAIL_MAX_BYTES,
  MCP_LIST_MAX_BYTES,
  mcpError,
  mcpJson,
  mcpJsonLimited,
  mcpWritesEnabled,
  requireMcpToken,
} from "@/lib/mcpApi";
import { logger } from "@/lib/logger";
import {
  createSeries,
  SeriesInputError,
  setSeriesCohorts,
  updateSeries,
} from "@/lib/seriesAdmin";

export const dynamic = "force-dynamic";

/** GET — list series, or one series (with occurrences) via ?id=. */
export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const series = await prisma.sessionSeries.findUnique({
      where: { id },
      include: {
        instructor: { select: { id: true, name: true, email: true } },
        cohorts: { include: { cohort: { select: { id: true, title: true, slug: true, status: true } } } },
        occurrences: {
          orderBy: { date: "asc" },
          select: {
            id: true, title: true, date: true, startTime: true, endTime: true,
            timezone: true, status: true, recordingLink: true, instructorId: true,
          },
        },
      },
    });
    if (!series) return mcpError("Series not found", 404);
    return mcpJsonLimited({ series }, MCP_DETAIL_MAX_BYTES);
  }

  const series = await prisma.sessionSeries.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      cohorts: { include: { cohort: { select: { id: true, title: true, status: true } } } },
      _count: { select: { occurrences: true } },
    },
  });

  return mcpJsonLimited({ series }, MCP_LIST_MAX_BYTES);
}

/** POST — create a series. */
export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;
  if (!(await mcpWritesEnabled())) return mcpError("MCP writes are disabled", 403);

  try {
    const created = await createSeries(await req.json());
    return mcpJson({ success: true, series: created }, 201);
  } catch (error) {
    if (error instanceof SeriesInputError) {
      return mcpError(error.message, 400);
    }
    logger.error({ err: error }, "[MCP_SESSION_SERIES_POST]");
    return mcpError("Internal Server Error", 500);
  }
}

/**
 * PATCH — update a series and/or set the cohorts it serves.
 *
 * `cohortIds` is the FULL desired set, not a delta: attaching covers another cohort
 * with the same call, detaching hands that cohort to a different series. Omit the key
 * entirely to leave attachments untouched.
 */
export async function PATCH(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;
  if (!(await mcpWritesEnabled())) return mcpError("MCP writes are disabled", 403);

  try {
    const body = await req.json();
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return mcpError("id is required", 400);

    const { id: _id, cohortIds, ...patch } = body;

    let series = null;
    if (Object.keys(patch).length > 0) {
      series = await updateSeries(id, patch);
    }

    let cohorts;
    if (cohortIds !== undefined) {
      if (!Array.isArray(cohortIds)) return mcpError("cohortIds must be an array", 400);
      cohorts = await setSeriesCohorts(id, cohortIds);
    }

    if (!series && cohorts === undefined) return mcpError("Nothing to update", 400);

    return mcpJson({ success: true, series, cohorts });
  } catch (error) {
    if (error instanceof SeriesInputError) {
      const status = error.message === "Series not found" ? 404 : 400;
      return mcpError(error.message, status);
    }
    logger.error({ err: error }, "[MCP_SESSION_SERIES_PATCH]");
    return mcpError("Internal Server Error", 500);
  }
}
