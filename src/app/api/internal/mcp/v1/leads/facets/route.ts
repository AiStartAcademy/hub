// src/app/api/internal/mcp/v1/leads/facets/route.ts
// Aggregate view of the leads table for campaign authoring: which statuses,
// sources and tags actually exist, and which onboarding quizzes feed them.
// Read-only, no PII — counts and distinct values only.

import prisma from "@/lib/prisma";
import { mcpError, mcpJson, parseJsonStringArray, requireMcpToken } from "@/lib/mcpApi";
import { LEAD_STATUSES } from "@/app/(dashboard)/admin/contacts/leadStatus";
import { logger } from "@/lib/logger";
import {
  pipelineContactWhere,
  summarizePipelineCounts,
} from "@/lib/leads/pipeline";

export const dynamic = "force-dynamic";

// Tag frequencies require parsing the tags JSON column in JS; cap the scan so a
// runaway leads table can't turn this into a full-table memory hog.
const TAG_SCAN_LIMIT = 20000;

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  try {
    const pipelineWhere = pipelineContactWhere();
    const [
      statusGroups,
      sourceGroups,
      allContactUnsubscribedCount,
      excludedFromPipelineCount,
      tagRows,
      forms,
      dripGroups,
      campaigns,
    ] =
      await Promise.all([
        prisma.contact.groupBy({
          by: ["status"],
          where: pipelineWhere,
          _count: { _all: true },
        }),
        prisma.contact.groupBy({
          by: ["source"],
          where: pipelineWhere,
          _count: { _all: true },
          orderBy: { _count: { id: "desc" } },
          take: 100,
        }),
        prisma.contact.count({ where: { unsubscribedAt: { not: null } } }),
        prisma.contact.count({ where: { excludeFromPipeline: true } }),
        prisma.contact.findMany({
          where: { ...pipelineWhere, tags: { not: null } },
          select: { tags: true },
          take: TAG_SCAN_LIMIT,
          orderBy: { createdAt: "desc" },
        }),
        prisma.onboardingForm.findMany({
          select: {
            slug: true,
            title: true,
            _count: { select: { responses: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.dripEnrollment.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.dripCampaign.findMany({
          select: {
            slug: true,
            name: true,
            status: true,
            _count: { select: { enrollments: true } },
          },
          orderBy: { priority: "asc" },
        }),
      ]);

    const pipelineStatuses: Record<string, number> = {};
    for (const s of LEAD_STATUSES) pipelineStatuses[s] = 0;
    for (const group of statusGroups) {
      pipelineStatuses[group.status ?? "NEW"] =
        (pipelineStatuses[group.status ?? "NEW"] ?? 0) + group._count._all;
    }

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      for (const tag of parseJsonStringArray(row.tags)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const pipelineTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
      .map(([tag, count]) => ({ tag, count }));

    const pipelineCounts = summarizePipelineCounts(
      Object.values(pipelineStatuses),
      excludedFromPipelineCount
    );

    return mcpJson({
      ...pipelineCounts,
      pipelineStatuses,
      pipelineSources: sourceGroups.map((group) => ({
        source: group.source,
        count: group._count._all,
      })),
      pipelineTags,
      pipelineTagScanCapped: tagRows.length === TAG_SCAN_LIMIT,
      allContactUnsubscribedCount,
      onboardingForms: forms.map((form) => ({
        slug: form.slug,
        title: form.title,
        responses: form._count.responses,
      })),
      dripEnrollmentStatuses: Object.fromEntries(
        dripGroups.map((g) => [g.status, g._count._all])
      ),
      dripCampaigns: campaigns.map((c) => ({
        slug: c.slug,
        name: c.name,
        status: c.status,
        enrollments: c._count.enrollments,
      })),
    });
  } catch (error) {
    logger.error(
      `[mcp] lead facets failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpError("Lead facets query failed", 500);
  }
}
