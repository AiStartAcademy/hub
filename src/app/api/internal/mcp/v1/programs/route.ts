import prisma from "@/lib/prisma";
import {
  boundedParam,
  MCP_DETAIL_MAX_BYTES,
  MCP_LIST_MAX_BYTES,
  mcpError,
  mcpJson,
  mcpJsonLimited,
  mcpWritesEnabled,
  parseMcpPagination,
  requireMcpToken,
} from "@/lib/mcpApi";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const PROGRAM_STATUSES = new Set(["draft", "open", "archived", "raw"]);
const ACCESS_MODES = new Set(["cohort", "direct", "auth", "public", "member"]);
const EDITABLE_FIELDS = [
  "name",
  "description",
  "cover",
  "accessMode",
  "status",
  "priceCents",
  "includesWeeklyCalls",
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
type EditableValue = string | number | boolean | null;
const WRITES_DISABLED_MESSAGE =
  "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true').";

interface ProgramPatchBody {
  id?: unknown;
  publish?: unknown;
  name?: unknown;
  description?: unknown;
  cover?: unknown;
  accessMode?: unknown;
  status?: unknown;
  priceCents?: unknown;
  includesWeeklyCalls?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * PATCH — edit an existing Program (course). No create — this route fills
 * out a Program that already exists (e.g. the recording-import target
 * created by cohort_create's rawProgramTitle).
 *
 * PUBLISH GUARDRAIL: moving status TO "open" (the only status that makes a
 * course publicly/member reachable) requires publish:true in the same call.
 * A plain status:"open" without it is refused — the one field here a
 * confused agent could use to put unfinished content in front of real
 * students.
 */
export async function PATCH(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpJson({ error: WRITES_DISABLED_MESSAGE }, 403);
  }

  let body: ProgramPatchBody;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) return mcpError("Expected a JSON object body", 400);
    body = parsed;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mcpError("Invalid JSON", 400);
  }

  if (typeof body.id !== "string" || !body.id.trim()) {
    return mcpError("id is required", 400);
  }

  for (const key of Object.keys(body)) {
    if (key !== "id" && key !== "publish" && !EDITABLE_FIELDS.includes(key as EditableField)) {
      return mcpError(`Rejected key: ${key}`, 400);
    }
  }

  if ("status" in body) {
    if (typeof body.status !== "string" || !PROGRAM_STATUSES.has(body.status)) {
      return mcpError(`status must be one of: ${[...PROGRAM_STATUSES].join(", ")}`, 400);
    }
    if (body.status === "open" && body.publish !== true) {
      return mcpError(
        "Setting status to 'open' publishes the course to real students. Refused without publish:true in the same call.",
        400
      );
    }
  }
  if ("accessMode" in body) {
    if (typeof body.accessMode !== "string" || !ACCESS_MODES.has(body.accessMode)) {
      return mcpError(`accessMode must be one of: ${[...ACCESS_MODES].join(", ")}`, 400);
    }
  }
  if ("name" in body && (typeof body.name !== "string" || !body.name.trim())) {
    return mcpError("name must be a non-empty string", 400);
  }
  if ("description" in body && typeof body.description !== "string") {
    return mcpError("description must be a string", 400);
  }
  if ("cover" in body && typeof body.cover !== "string") {
    return mcpError("cover must be a string (GCS proxy URL)", 400);
  }
  if (
    "priceCents" in body &&
    body.priceCents !== null &&
    (typeof body.priceCents !== "number" ||
      !Number.isInteger(body.priceCents) ||
      body.priceCents < 0)
  ) {
    return mcpError("priceCents must be null or a non-negative integer", 400);
  }
  if ("includesWeeklyCalls" in body && typeof body.includesWeeklyCalls !== "boolean") {
    return mcpError("includesWeeklyCalls must be a boolean", 400);
  }

  try {
    const program = await prisma.program.findUnique({
      where: { id: body.id as string },
      select: {
        id: true,
        name: true,
        description: true,
        cover: true,
        accessMode: true,
        status: true,
        priceCents: true,
        includesWeeklyCalls: true,
      },
    });
    if (!program) return mcpError("Program not found", 404);

    const changed: Partial<Record<EditableField, { from: EditableValue; to: EditableValue }>> = {};
    const unchanged: EditableField[] = [];
    const data: Record<string, EditableValue> = {};

    for (const field of EDITABLE_FIELDS) {
      if (!(field in body)) continue;
      const nextValue = body[field];
      if (
        typeof nextValue !== "string" &&
        typeof nextValue !== "number" &&
        typeof nextValue !== "boolean" &&
        nextValue !== null
      ) {
        return mcpError(`Invalid value for ${field}`, 400);
      }
      const currentValue = program[field] ?? null;
      if (currentValue === nextValue) {
        unchanged.push(field);
      } else {
        changed[field] = { from: currentValue, to: nextValue };
        data[field] = nextValue;
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.program.update({ where: { id: program.id }, data });
    }

    console.info("[mcp-audit] program_update", {
      actor: "mcp",
      programId: program.id,
      changedKeys: Object.keys(changed),
      publishedNow: body.status === "open",
    });

    return mcpJson({ id: program.id, changed, unchanged });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] program update failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Program update failed", correlationId }, 500);
  }
}

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = boundedParam(url, "id", 128);
  if (id) {
    try {
      const program = await prisma.program.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          description: true,
          cover: true,
          status: true,
          locked: true,
          accessMode: true,
          createdAt: true,
          updatedAt: true,
          modules: { select: { id: true, name: true } },
          _count: { select: { cohorts: true, enrollments: true } },
        },
      });
      if (!program) return mcpError("Program not found", 404);
      const { _count, ...core } = program;
      return mcpJsonLimited(
        { item: { ...core, cohortCount: _count.cohorts, enrollmentCount: _count.enrollments } },
        MCP_DETAIL_MAX_BYTES
      );
    } catch (error) {
      const correlationId = crypto.randomUUID();
      logger.error(
        `[mcp:${correlationId}] program detail query failed (${error instanceof Error ? error.name : "unknown"})`
      );
      return mcpJson({ error: "Program query failed", correlationId }, 500);
    }
  }

  const { page, pageSize, skip } = parseMcpPagination(url);
  const status = boundedParam(url, "status", 32)?.toLowerCase();
  if (status && !PROGRAM_STATUSES.has(status)) {
    return mcpError("Invalid program status", 400);
  }
  const q = boundedParam(url, "q", 200);
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { name: { contains: q } } : {}),
  };

  try {
    const [total, programs] = await prisma.$transaction([
      prisma.program.count({ where }),
      prisma.program.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          accessMode: true,
          updatedAt: true,
          _count: { select: { cohorts: true } },
        },
      }),
    ]);

    const items = programs.map(({ _count, ...program }) => ({
      ...program,
      cohortCount: _count.cohorts,
    }));
    return mcpJsonLimited(
      { items, page, pageSize, total, hasMore: skip + items.length < total },
      MCP_LIST_MAX_BYTES
    );
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] program list query failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Program query failed", correlationId }, 500);
  }
}
