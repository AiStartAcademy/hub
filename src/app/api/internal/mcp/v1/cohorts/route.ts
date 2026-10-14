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
import { syncCohortInstructors } from "@/lib/instructorParticipation";

export const dynamic = "force-dynamic";

const COHORT_STATUSES = new Set([
  "DRAFT",
  "ENROLLMENT",
  "IN_PROGRESS",
  "COMPLETE",
  "ARCHIVED",
]);

const DELIVERY_MODES = new Set(["ONLINE", "INPERSON", "HYBRID"]);

/**
 * Deliberately excludes: status (never MCP-settable, see cohort/route.ts),
 * zoomLink/zoomMeetingId/createZoomMeeting (a wrong PATCH here would desync the
 * live meeting from Cohort rows without touching the meeting itself), and
 * groups (seat tiers touch payments/bookings — out of scope for v1 PATCH).
 * Those still require the admin UI or a future dedicated tool.
 */
const PATCH_KEYS = [
  "title",
  "description",
  "deliveryMode",
  "location",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "timezone",
  "instructorEmails",
  "programTitles",
] as const;
type PatchKey = (typeof PATCH_KEYS)[number];
type PatchBody = Partial<Record<PatchKey, unknown>> & { id?: unknown; slug?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseDateOrNull(v: unknown, field: string): Date | null | string {
  if (v === null) return null;
  if (typeof v !== "string" || !v.trim()) return `${field} must be an ISO date string or null`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return `${field} is not a valid date: ${v}`;
  return d;
}

export async function PATCH(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpError("MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true').", 403);
  }

  let body: PatchBody;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) return mcpError("Expected a JSON object body", 400);
    body = parsed;
  } catch {
    return mcpError("Invalid JSON", 400);
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if ((id ? 1 : 0) + (slug ? 1 : 0) !== 1) {
    return mcpError("Provide exactly one of id or slug", 400);
  }

  for (const key of Object.keys(body)) {
    if (key === "id" || key === "slug") continue;
    if (!PATCH_KEYS.includes(key as PatchKey)) {
      return mcpError(
        `Rejected key: ${key}. Writable fields: ${PATCH_KEYS.join(", ")}. ` +
          `status/zoomLink/groups are not editable via this tool — use the admin UI.`,
        400
      );
    }
  }

  try {
    const current = await prisma.cohort.findFirst({
      where: id ? { id } : { slug },
      select: {
        id: true,
        title: true,
        description: true,
        deliveryMode: true,
        location: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        timezone: true,
        instructors: { select: { id: true, name: true, email: true } },
        programs: { select: { id: true, name: true } },
      },
    });
    if (!current) return mcpError("Cohort not found", 404);

    const data: Record<string, unknown> = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    const unchanged: string[] = [];

    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return mcpError("title must be a non-empty string", 400);
      }
      const next = body.title.trim();
      if (next === current.title) unchanged.push("title");
      else {
        changed.title = { from: current.title, to: next };
        data.title = next;
      }
    }

    if ("description" in body) {
      if (body.description !== null && typeof body.description !== "string") {
        return mcpError("description must be a string or null", 400);
      }
      const next = body.description === null ? null : (body.description as string).trim() || null;
      if (next === current.description) unchanged.push("description");
      else {
        changed.description = { from: current.description, to: next };
        data.description = next;
      }
    }

    if ("deliveryMode" in body) {
      const next = typeof body.deliveryMode === "string" ? body.deliveryMode.toUpperCase() : "";
      if (!DELIVERY_MODES.has(next)) {
        return mcpError(`deliveryMode must be one of ${[...DELIVERY_MODES].join(", ")}`, 400);
      }
      if (next === current.deliveryMode) unchanged.push("deliveryMode");
      else {
        changed.deliveryMode = { from: current.deliveryMode, to: next };
        data.deliveryMode = next;
      }
    }

    if ("location" in body) {
      if (body.location !== null && typeof body.location !== "string") {
        return mcpError("location must be a string or null", 400);
      }
      const next = body.location === null ? null : (body.location as string).trim() || null;
      if (next === current.location) unchanged.push("location");
      else {
        changed.location = { from: current.location, to: next };
        data.location = next;
      }
    }

    for (const [key, currentValue] of [
      ["startDate", current.startDate] as const,
      ["endDate", current.endDate] as const,
    ]) {
      if (!(key in body)) continue;
      const parsed = parseDateOrNull(body[key], key);
      if (typeof parsed === "string") return mcpError(parsed, 400);
      const currentIso = currentValue ? currentValue.toISOString() : null;
      const nextIso = parsed ? parsed.toISOString() : null;
      if (currentIso === nextIso) unchanged.push(key);
      else {
        changed[key] = { from: currentIso, to: nextIso };
        data[key] = parsed;
      }
    }

    for (const key of ["startTime", "endTime", "timezone"] as const) {
      if (!(key in body)) continue;
      if (body[key] !== null && typeof body[key] !== "string") {
        return mcpError(`${key} must be a string or null`, 400);
      }
      const next = body[key] === null ? null : (body[key] as string).trim() || null;
      const currentValue = current[key];
      if (next === currentValue) unchanged.push(key);
      else {
        changed[key] = { from: currentValue, to: next };
        data[key] = next;
      }
    }

    // instructorEmails / programTitles: full-set replace, same fail-closed contract as
    // cohort_create — unknown entries refuse the whole request rather than being skipped.
    if ("instructorEmails" in body) {
      const emails = Array.isArray(body.instructorEmails)
        ? (body.instructorEmails as unknown[]).filter((e): e is string => typeof e === "string" && !!e.trim())
        : null;
      if (emails === null) return mcpError("instructorEmails must be an array of strings", 400);
      const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
      const found = new Set(users.map((u) => u.email));
      const missing = emails.filter((e) => !found.has(e));
      if (missing.length) {
        return mcpError(`instructorEmails not found as existing Users: ${missing.join(", ")}`, 400);
      }
      const currentEmails = current.instructors.map((i) => i.email).sort();
      const nextEmails = [...emails].sort();
      if (JSON.stringify(currentEmails) === JSON.stringify(nextEmails)) {
        unchanged.push("instructorEmails");
      } else {
        changed.instructorEmails = { from: currentEmails, to: nextEmails };
        data.instructors = { set: users.map((u) => ({ id: u.id })) };
      }
    }

    if ("programTitles" in body) {
      const titles = Array.isArray(body.programTitles)
        ? (body.programTitles as unknown[]).filter((t): t is string => typeof t === "string" && !!t.trim())
        : null;
      if (titles === null) return mcpError("programTitles must be an array of strings", 400);
      const programs = await prisma.program.findMany({ where: { name: { in: titles } }, select: { id: true, name: true } });
      const found = new Set(programs.map((p) => p.name));
      const missing = titles.filter((t) => !found.has(t));
      if (missing.length) {
        return mcpError(`programTitles not found as existing Programs: ${missing.join(", ")}`, 400);
      }
      const currentTitles = current.programs.map((p) => p.name).sort();
      const nextTitles = [...titles].sort();
      if (JSON.stringify(currentTitles) === JSON.stringify(nextTitles)) {
        unchanged.push("programTitles");
      } else {
        changed.programTitles = { from: currentTitles, to: nextTitles };
        data.programs = { set: programs.map((p) => ({ id: p.id })) };
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.cohort.update({ where: { id: current.id }, data });
      if (changed.instructorEmails) {
        await syncCohortInstructors(current.id);
      }
    }

    console.info("[mcp-audit] cohort_update", {
      actor: "mcp",
      cohortId: current.id,
      changedKeys: Object.keys(changed),
    });

    return mcpJson({ id: current.id, changed, unchanged });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] cohort update failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Cohort update failed", correlationId }, 500);
  }
}

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = boundedParam(url, "id", 128);
  const slug = boundedParam(url, "slug", 200);
  if (id && slug) return mcpError("Provide id or slug, not both", 400);

  try {
    if (id || slug) {
      const now = new Date();
      const cohort = await prisma.cohort.findFirst({
        where: id ? { id } : { slug },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          cover: true,
          status: true,
          deliveryMode: true,
          location: true,
          startDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          timezone: true,
          tools: true,
          certificate: true,
          leadMagnet: true,
          leadMagnetCta: true,
          createdAt: true,
          updatedAt: true,
          groups: {
            select: {
              id: true,
              name: true,
              price: true,
              seats: true,
              inPerson: true,
              allowOneOnOne: true,
              _count: { select: { members: true } },
              payments: {
                where: { status: "pending", expiresAt: { gt: now } },
                select: { id: true },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          sessions: {
            select: {
              id: true,
              title: true,
              description: true,
              date: true,
              startTime: true,
              endTime: true,
              timezone: true,
              status: true,
              order: true,
            },
            orderBy: [{ order: "asc" }, { date: "asc" }],
          },
          instructors: {
            select: { id: true, name: true, image: true },
          },
          programs: {
            select: { id: true, name: true, status: true, updatedAt: true },
          },
          _count: { select: { enrollments: true } },
        },
      });
      if (!cohort) return mcpError("Cohort not found", 404);

      const groups = cohort.groups.map(({ _count, payments, ...group }) => {
        const reserved = payments.length;
        return {
          ...group,
          members: _count.members,
          pendingReservations: reserved,
          availableSeats: Math.max(0, group.seats - _count.members - reserved),
        };
      });
      const { _count, ...core } = cohort;
      return mcpJsonLimited(
        { item: { ...core, groups, enrollments: _count.enrollments } },
        MCP_DETAIL_MAX_BYTES
      );
    }

    const { page, pageSize, skip } = parseMcpPagination(url);
    const status = boundedParam(url, "status", 32)?.toUpperCase();
    if (status && !COHORT_STATUSES.has(status)) {
      return mcpError("Invalid cohort status", 400);
    }
    const q = boundedParam(url, "q", 200);
    const where = {
      ...(status ? { status } : {}),
      ...(q ? { title: { contains: q } } : {}),
    };

    const [total, cohorts] = await prisma.$transaction([
      prisma.cohort.count({ where }),
      prisma.cohort.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          deliveryMode: true,
          location: true,
          startDate: true,
          endDate: true,
          timezone: true,
          leadMagnet: true,
          updatedAt: true,
          groups: {
            select: { seats: true, _count: { select: { members: true } } },
          },
          _count: { select: { sessions: true, enrollments: true } },
        },
      }),
    ]);

    const items = cohorts.map(({ groups, _count, ...cohort }) => ({
      ...cohort,
      seats: groups.reduce((sum, group) => sum + group.seats, 0),
      groupMembers: groups.reduce((sum, group) => sum + group._count.members, 0),
      sessions: _count.sessions,
      enrollments: _count.enrollments,
    }));
    return mcpJsonLimited(
      { items, page, pageSize, total, hasMore: skip + items.length < total },
      MCP_LIST_MAX_BYTES
    );
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] cohort query failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Cohort query failed", correlationId }, 500);
  }
}
