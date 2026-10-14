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
import {
  MAX_DRIP_STEPS,
  createDripCampaign,
  normalizeDripSettings,
  normalizeDripStepSequence,
  replaceDripSteps,
  stepReplacementRefusalReason,
  updateDripCampaignSegment,
  updateDripCampaignSettings,
  type DripSettingsInput,
} from "@/lib/drip/admin";
import { CAMPAIGN_STATUSES } from "@/lib/drip/constants";
import { countSegmentMatches } from "@/lib/drip/engine";
import { describeSegment, parseSegment, serializeSegment, type DripSegment } from "@/lib/drip/segment";

export const dynamic = "force-dynamic";

const STATUS_SET = new Set<string>(CAMPAIGN_STATUSES);
const IDENTIFIER_MAX_LENGTH = 191;

// Status changes stay admin-UI-only so MCP cannot activate or pause live campaigns.
const WRITE_FIELDS = [
  "name",
  "description",
  "trigger",
  "priority",
  "timezone",
  "sendWindowStartHour",
  "sendWindowEndHour",
  "skipWeekends",
  "exitOnStatuses",
  "testEmail",
  "autoEnroll",
  "segment",
  "steps",
] as const;

const SETTINGS_FIELDS = [
  "name",
  "description",
  "trigger",
  "priority",
  "timezone",
  "sendWindowStartHour",
  "sendWindowEndHour",
  "skipWeekends",
  "exitOnStatuses",
  "testEmail",
  "autoEnroll",
] as const;

type WriteField = (typeof WRITE_FIELDS)[number];
type SettingField = (typeof SETTINGS_FIELDS)[number];
type WriteBody = Partial<Record<WriteField, unknown>> & {
  id?: unknown;
  slug?: unknown;
  status?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) return mcpError("Expected a JSON object body", 400);
    return parsed;
  } catch {
    return mcpError("Invalid JSON", 400);
  }
}

function validateBodyKeys(body: Record<string, unknown>, includeTargetKeys: boolean): string | null {
  if ("status" in body) return "status is not writable via MCP";

  for (const key of Object.keys(body)) {
    if (WRITE_FIELDS.includes(key as WriteField)) continue;
    if (includeTargetKeys && (key === "id" || key === "slug")) continue;
    return includeTargetKeys
      ? `Rejected key: ${key}. Writable fields: ${WRITE_FIELDS.join(", ")}. Target with exactly one of id or slug.`
      : `Rejected key: ${key}. Writable fields: ${WRITE_FIELDS.join(", ")}.`;
  }

  return null;
}

function parseStoredExitOnStatuses(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function parseSegmentInput(value: unknown): { segment: DripSegment; serialized: string } | string {
  if (!isRecord(value)) return "segment must be an object";
  const segment = parseSegment(JSON.stringify(value));
  return { segment, serialized: serializeSegment(segment) };
}

function parseStepsInput(value: unknown) {
  if (!Array.isArray(value)) return "steps must be an array";
  try {
    return normalizeDripStepSequence(value);
  } catch (error) {
    return error instanceof Error ? error.message : `steps must contain at most ${MAX_DRIP_STEPS} items`;
  }
}

function normalizeSettingsOrError(input: DripSettingsInput) {
  try {
    return normalizeDripSettings(input);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid campaign settings";
  }
}

function getRequestedSettingFields(body: WriteBody): SettingField[] {
  return SETTINGS_FIELDS.filter((field) => field in body);
}

async function buildListItems(
  campaigns: Array<{
    id: string;
    slug: string;
    name: string;
    status: string;
    trigger: string;
    priority: number;
    autoEnroll: boolean;
    timezone: string;
    sendWindowStartHour: number;
    sendWindowEndHour: number;
    skipWeekends: boolean;
    segment: string;
    _count: { steps: number };
  }>
) {
  if (campaigns.length === 0) return [];

  const campaignIds = campaigns.map((campaign) => campaign.id);
  const enrollmentGroups = await prisma.dripEnrollment.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });

  const enrollmentCounts = new Map<string, { active: number; completed: number; exited: number; paused: number }>();
  for (const group of enrollmentGroups) {
    const current =
      enrollmentCounts.get(group.campaignId) ?? { active: 0, completed: 0, exited: 0, paused: 0 };
    if (group.status === "ACTIVE") current.active = group._count._all;
    if (group.status === "COMPLETED") current.completed = group._count._all;
    if (group.status === "EXITED") current.exited = group._count._all;
    if (group.status === "PAUSED") current.paused = group._count._all;
    enrollmentCounts.set(group.campaignId, current);
  }

  const sendCounts = new Map(
    await Promise.all(
      campaigns.map(async (campaign) => {
        const [sentCount, failedCount] = await Promise.all([
          prisma.dripSend.count({ where: { status: "SENT", enrollment: { campaignId: campaign.id } } }),
          prisma.dripSend.count({ where: { status: "FAILED", enrollment: { campaignId: campaign.id } } }),
        ]);

        return [campaign.id, { sentCount, failedCount }] as const;
      })
    )
  );

  return campaigns.map((campaign) => {
    const counts = enrollmentCounts.get(campaign.id) ?? {
      active: 0,
      completed: 0,
      exited: 0,
      paused: 0,
    };
    const sends = sendCounts.get(campaign.id) ?? { sentCount: 0, failedCount: 0 };

    return {
      id: campaign.id,
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      trigger: campaign.trigger,
      priority: campaign.priority,
      autoEnroll: campaign.autoEnroll,
      timezone: campaign.timezone,
      sendWindowStartHour: campaign.sendWindowStartHour,
      sendWindowEndHour: campaign.sendWindowEndHour,
      skipWeekends: campaign.skipWeekends,
      stepCount: campaign._count.steps,
      enrollmentCounts: counts,
      sentCount: sends.sentCount,
      failedCount: sends.failedCount,
      segmentSummary: describeSegment(parseSegment(campaign.segment)),
    };
  });
}

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = boundedParam(url, "id", IDENTIFIER_MAX_LENGTH);
  const slug = boundedParam(url, "slug", IDENTIFIER_MAX_LENGTH);

  if (id && slug) return mcpError("Provide exactly one of id or slug", 400);

  try {
    if (id || slug) {
      const campaign = await prisma.dripCampaign.findFirst({
        where: id ? { id } : { slug },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          status: true,
          trigger: true,
          priority: true,
          autoEnroll: true,
          timezone: true,
          sendWindowStartHour: true,
          sendWindowEndHour: true,
          skipWeekends: true,
          segment: true,
          exitOnStatuses: true,
          testEmail: true,
          steps: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              order: true,
              delayHours: true,
              anchor: true,
              offsetMinutes: true,
              channel: true,
              subject: true,
              body: true,
              ctaLabel: true,
              ctaUrl: true,
              callAssistantId: true,
              callFirstMessage: true,
            },
          },
          _count: { select: { steps: true } },
        },
      });

      if (!campaign) return mcpError("Campaign not found", 404);

      const [summary] = await buildListItems([campaign]);
      return mcpJsonLimited(
        {
          item: {
            ...summary,
            description: campaign.description,
            segment: parseSegment(campaign.segment),
            exitOnStatuses: parseStoredExitOnStatuses(campaign.exitOnStatuses),
            testEmail: campaign.testEmail,
            steps: campaign.steps,
          },
        },
        MCP_DETAIL_MAX_BYTES
      );
    }

    const status = boundedParam(url, "status", 32);
    if (status && !STATUS_SET.has(status)) {
      return mcpError(`status must be one of ${CAMPAIGN_STATUSES.join(", ")}`, 400);
    }

    const { page, pageSize, skip } = parseMcpPagination(url);
    const where = status ? { status } : undefined;
    const [total, campaigns] = await Promise.all([
      prisma.dripCampaign.count({ where }),
      prisma.dripCampaign.findMany({
        where,
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          trigger: true,
          priority: true,
          autoEnroll: true,
          timezone: true,
          sendWindowStartHour: true,
          sendWindowEndHour: true,
          skipWeekends: true,
          segment: true,
          _count: { select: { steps: true } },
        },
      }),
    ]);

    const items = await buildListItems(campaigns);
    return mcpJsonLimited(
      {
        items,
        page,
        pageSize,
        total,
        hasMore: skip + items.length < total,
      },
      MCP_LIST_MAX_BYTES
    );
  } catch (error) {
    const correlationId = crypto.randomUUID();
    console.error(`[mcp:${correlationId}] drip lookup failed (${error instanceof Error ? error.name : "unknown"})`);
    return mcpJson({ error: "Drip request failed", correlationId }, 500);
  }
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpError("MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true').", 403);
  }

  const bodyResult = await readJsonBody(req);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult as WriteBody;

  const keyError = validateBodyKeys(body, false);
  if (keyError) return mcpError(keyError, 400);

  if (typeof body.name !== "string" || !body.name.trim()) {
    return mcpError("name must be a non-empty string", 400);
  }

  const normalizedSettings = normalizeSettingsOrError({
    name: body.name,
    description: body.description,
    trigger: body.trigger,
    autoEnroll: body.autoEnroll,
    priority: body.priority,
    timezone: body.timezone,
    sendWindowStartHour: body.sendWindowStartHour,
    sendWindowEndHour: body.sendWindowEndHour,
    skipWeekends: body.skipWeekends,
    exitOnStatuses: body.exitOnStatuses,
    testEmail: body.testEmail,
  });
  if (typeof normalizedSettings === "string") return mcpError(normalizedSettings, 400);

  let segment: DripSegment = parseSegment(undefined);
  if ("segment" in body) {
    const parsedSegment = parseSegmentInput(body.segment);
    if (typeof parsedSegment === "string") return mcpError(parsedSegment, 400);
    segment = parsedSegment.segment;
  }

  let normalizedSteps: ReturnType<typeof normalizeDripStepSequence> | null = null;
  if ("steps" in body) {
    const parsedSteps = parseStepsInput(body.steps);
    if (typeof parsedSteps === "string") return mcpError(parsedSteps, 400);
    normalizedSteps = parsedSteps;
  }

  try {
    const created = await createDripCampaign({ name: body.name });

    await updateDripCampaignSettings(created.id, normalizedSettings);

    if ("segment" in body) {
      await updateDripCampaignSegment(created.id, segment);
    }

    const stepsCreated = normalizedSteps ? await replaceDripSteps(created.id, normalizedSteps.steps) : 0;
    const stored = await prisma.dripCampaign.findUnique({
      where: { id: created.id },
      select: { id: true, slug: true, name: true, status: true, segment: true },
    });

    if (!stored) {
      const correlationId = crypto.randomUUID();
      console.error(`[mcp:${correlationId}] drip create failed (Error)`);
      return mcpJson({ error: "Drip campaign create failed", correlationId }, 500);
    }

    const storedSegment = parseSegment(stored.segment);
    const segmentMatchCount = await countSegmentMatches(storedSegment);

    console.info("[mcp-audit] drip_create", {
      actor: "mcp",
      campaignId: stored.id,
      stepsCreated,
    });

    return mcpJson({
      id: stored.id,
      slug: stored.slug,
      name: stored.name,
      status: stored.status,
      slugWasAdjusted: created.slugWasAdjusted,
      stepsCreated,
      segmentMatchCount,
      warnings: normalizedSteps?.warnings ?? [],
    });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    console.error(`[mcp:${correlationId}] drip create failed (${error instanceof Error ? error.name : "unknown"})`);
    return mcpJson({ error: "Drip campaign create failed", correlationId }, 500);
  }
}

export async function PATCH(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpError("MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true').", 403);
  }

  const bodyResult = await readJsonBody(req);
  if (bodyResult instanceof Response) return bodyResult;
  const body = bodyResult as WriteBody;

  const keyError = validateBodyKeys(body, true);
  if (keyError) return mcpError(keyError, 400);

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if ((id ? 1 : 0) + (slug ? 1 : 0) !== 1) {
    return mcpError("Provide exactly one of id or slug", 400);
  }

  try {
    const current = await prisma.dripCampaign.findFirst({
      where: id ? { id } : { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        status: true,
        trigger: true,
        segment: true,
        autoEnroll: true,
        exitOnStatuses: true,
        priority: true,
        timezone: true,
        sendWindowStartHour: true,
        sendWindowEndHour: true,
        skipWeekends: true,
        testEmail: true,
        steps: {
          orderBy: { order: "asc" },
          select: {
            order: true,
            delayHours: true,
            anchor: true,
            offsetMinutes: true,
            channel: true,
            subject: true,
            body: true,
            ctaLabel: true,
            ctaUrl: true,
            callAssistantId: true,
            callFirstMessage: true,
          },
        },
      },
    });

    if (!current) return mcpError("Campaign not found", 404);

    if ("steps" in body && current.status !== "DRAFT") {
      // Reordering live steps can break the runner's lastStepOrder + 1 walk and skip or resend messages.
      return mcpError(stepReplacementRefusalReason(current.status) ?? `Cannot replace steps while status is ${current.status}`, 409);
    }

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    const unchanged: string[] = [];
    const requestedSettingFields = getRequestedSettingFields(body);
    const currentExitOnStatuses = parseStoredExitOnStatuses(current.exitOnStatuses);
    const currentSegment = parseSegment(current.segment);
    const currentSegmentSerialized = serializeSegment(currentSegment);
    let nextSegment = currentSegment;

    let normalizedSettings: ReturnType<typeof normalizeDripSettings> | null = null;
    if (requestedSettingFields.length > 0) {
      const parsedSettings = normalizeSettingsOrError({
        name: "name" in body ? body.name : current.name,
        description: "description" in body ? body.description : current.description,
        trigger: "trigger" in body ? body.trigger : current.trigger,
        autoEnroll: "autoEnroll" in body ? body.autoEnroll : current.autoEnroll,
        priority: "priority" in body ? body.priority : current.priority,
        timezone: "timezone" in body ? body.timezone : current.timezone,
        sendWindowStartHour:
          "sendWindowStartHour" in body ? body.sendWindowStartHour : current.sendWindowStartHour,
        sendWindowEndHour: "sendWindowEndHour" in body ? body.sendWindowEndHour : current.sendWindowEndHour,
        skipWeekends: "skipWeekends" in body ? body.skipWeekends : current.skipWeekends,
        exitOnStatuses: "exitOnStatuses" in body ? body.exitOnStatuses : currentExitOnStatuses,
        testEmail: "testEmail" in body ? body.testEmail : current.testEmail,
      });
      if (typeof parsedSettings === "string") return mcpError(parsedSettings, 400);
      normalizedSettings = parsedSettings;

      for (const field of requestedSettingFields) {
        if (field === "exitOnStatuses") {
          const previous = sortedStrings(currentExitOnStatuses);
          const next = sortedStrings(normalizedSettings.exitOnStatuses);
          if (arraysEqual(previous, next)) unchanged.push(field);
          else changed[field] = { from: previous, to: next };
          continue;
        }

        const previous = current[field];
        const next = normalizedSettings[field];
        if (previous === next) unchanged.push(field);
        else changed[field] = { from: previous, to: next };
      }
    }

    let segmentChanged = false;
    if ("segment" in body) {
      const parsedSegment = parseSegmentInput(body.segment);
      if (typeof parsedSegment === "string") return mcpError(parsedSegment, 400);
      nextSegment = parsedSegment.segment;
      if (parsedSegment.serialized === currentSegmentSerialized) unchanged.push("segment");
      else {
        changed.segment = { from: currentSegment, to: nextSegment };
        segmentChanged = true;
      }
    }

    let normalizedSteps: ReturnType<typeof normalizeDripStepSequence> | null = null;
    let stepsReplaced: number | null = null;
    if ("steps" in body) {
      const parsedSteps = parseStepsInput(body.steps);
      if (typeof parsedSteps === "string") return mcpError(parsedSteps, 400);
      normalizedSteps = parsedSteps;

      const currentSteps = current.steps.map((step) => ({
        order: step.order,
        delayHours: step.delayHours,
        anchor: step.anchor,
        offsetMinutes: step.offsetMinutes,
        channel: step.channel,
        subject: step.subject,
        body: step.body,
        ctaLabel: step.ctaLabel,
        ctaUrl: step.ctaUrl,
        callAssistantId: step.callAssistantId,
        callFirstMessage: step.callFirstMessage,
      }));

      if (JSON.stringify(currentSteps) === JSON.stringify(parsedSteps.steps)) unchanged.push("steps");
      else stepsReplaced = parsedSteps.steps.length;
    }

    if (normalizedSettings && Object.keys(changed).some((key) => SETTINGS_FIELDS.includes(key as SettingField))) {
      await updateDripCampaignSettings(current.id, normalizedSettings);
    }

    if (segmentChanged) {
      await updateDripCampaignSegment(current.id, nextSegment);
    }

    if (stepsReplaced !== null) {
      stepsReplaced = await replaceDripSteps(current.id, normalizedSteps?.steps ?? []);
    }

    const segmentMatchCount = await countSegmentMatches(nextSegment);
    const changedKeys = [...Object.keys(changed), ...(stepsReplaced !== null ? ["steps"] : [])];

    console.info("[mcp-audit] drip_update", {
      actor: "mcp",
      campaignId: current.id,
      changedKeys,
    });

    return mcpJson({
      id: current.id,
      changed,
      unchanged,
      stepsReplaced,
      isLiveEdit: current.status !== "DRAFT",
      segmentMatchCount,
      warnings: normalizedSteps?.warnings ?? [],
    });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    console.error(`[mcp:${correlationId}] drip update failed (${error instanceof Error ? error.name : "unknown"})`);
    return mcpJson({ error: "Drip campaign update failed", correlationId }, 500);
  }
}
