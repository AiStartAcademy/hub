import prisma from "@/lib/prisma";
import {
  boundedParam,
  MCP_DETAIL_MAX_BYTES,
  MCP_LIST_MAX_BYTES,
  mcpError,
  mcpJson,
  mcpJsonLimited,
  parseJsonObject,
  parseJsonStringArray,
  parseMcpPagination,
  requireMcpToken,
} from "@/lib/mcpApi";
import { logger } from "@/lib/logger";
import { getLeadTimeline } from "@/lib/leads/timeline";

export const dynamic = "force-dynamic";

const LEAD_STATUSES = new Set(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]);

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = boundedParam(url, "id", 128);

  try {
    if (id) {
      const lead = await prisma.contact.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          status: true,
          source: true,
          attribution: true,
          tags: true,
          notes: true,
          lastActivityAt: true,
          createdAt: true,
          updatedAt: true,
          unsubscribedAt: true,
          events: {
            orderBy: { createdAt: "desc" },
            take: 101,
            select: {
              id: true,
              type: true,
              metadata: true,
              utmSource: true,
              utmMedium: true,
              utmCampaign: true,
              utmContent: true,
              createdAt: true,
            },
          },
          dripEnrollments: {
            orderBy: { enrolledAt: "desc" },
            take: 20,
            select: {
              status: true,
              lastStepOrder: true,
              nextRunAt: true,
              exitReason: true,
              enrolledAt: true,
              campaign: { select: { name: true, slug: true } },
            },
          },
          contactNotes: {
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { body: true, authorLabel: true, kind: true, createdAt: true },
          },
        },
      });
      if (!lead) return mcpError("Lead not found", 404);

      // Engagement + timeline answer "what have we said to this person, and what
      // did they do with it" without the agent having to reconstruct it.
      const [engagement, timeline] = await Promise.all([
        prisma.emailEvent.groupBy({
          by: ["type"],
          where: { contactId: lead.id },
          _count: { _all: true },
        }),
        getLeadTimeline(lead.id, { take: 20 }),
      ]);
      const countOf = (type: string) =>
        engagement.find((g) => g.type === type)?._count._all ?? 0;

      const eventsTruncated = lead.events.length > 100;
      return mcpJsonLimited(
        {
          item: {
            ...lead,
            attribution: parseJsonObject(lead.attribution),
            tags: parseJsonStringArray(lead.tags),
            events: lead.events.slice(0, 100).map((event) => ({
              ...event,
              metadata: parseJsonObject(event.metadata),
            })),
            eventsTruncated,
            dripEnrollments: lead.dripEnrollments.map((e) => ({
              campaignName: e.campaign.name,
              campaignSlug: e.campaign.slug,
              status: e.status,
              lastStepOrder: e.lastStepOrder,
              nextRunAt: e.nextRunAt,
              exitReason: e.exitReason,
              enrolledAt: e.enrolledAt,
            })),
            engagement: {
              sent: countOf("SENT"),
              opened: countOf("OPENED"),
              clicked: countOf("CLICKED"),
              failed: countOf("FAILED"),
              unsubscribed: countOf("UNSUBSCRIBED"),
              // Opens are inflated by mail-privacy prefetching; clicks are the
              // signal worth acting on. Stated here so an agent reading this
              // payload doesn't treat the two as equally meaningful.
              note: "opens are directional only; clicks are reliable",
            },
            timeline: timeline.items,
          },
        },
        MCP_DETAIL_MAX_BYTES
      );
    }

    const { page, pageSize, skip } = parseMcpPagination(url);
    const status = boundedParam(url, "status", 32)?.toUpperCase();
    if (status && !LEAD_STATUSES.has(status)) {
      return mcpError("Invalid lead status", 400);
    }
    const source = boundedParam(url, "source", 200);
    const tag = boundedParam(url, "tag", 200);
    const campaign = boundedParam(url, "campaign", 200);
    const q = boundedParam(url, "q", 200);
    const where = {
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(tag ? { tags: { contains: JSON.stringify(tag).slice(1, -1) } } : {}),
      ...(campaign ? { attribution: { contains: campaign } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    };

    const [total, leads] = await prisma.$transaction([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          source: true,
          tags: true,
          lastActivityAt: true,
          createdAt: true,
          updatedAt: true,
          // One bounded row: the campaign a lead is actively in, if any. Enough
          // to triage a list without a second call per lead.
          dripEnrollments: {
            where: { status: "ACTIVE" },
            take: 1,
            select: { lastStepOrder: true, campaign: { select: { name: true, slug: true } } },
          },
        },
      }),
    ]);

    const items = leads.map(({ dripEnrollments, ...lead }) => ({
      ...lead,
      tags: parseJsonStringArray(lead.tags),
      activeDrip: dripEnrollments[0]
        ? {
            campaignName: dripEnrollments[0].campaign.name,
            campaignSlug: dripEnrollments[0].campaign.slug,
            lastStepOrder: dripEnrollments[0].lastStepOrder,
          }
        : null,
    }));
    return mcpJsonLimited(
      { items, page, pageSize, total, hasMore: skip + items.length < total },
      MCP_LIST_MAX_BYTES
    );
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] lead query failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Lead query failed", correlationId }, 500);
  }
}
