// src/app/api/content/ingest/route.ts
// POST — the agents service writes a generated draft here (bearer CONTENT_INGEST_TOKEN).
// Idempotent on slug: re-ingesting updates generated content but never clobbers a
// row a human has already moved past review (PUBLISHED/DISABLED/ARCHIVED).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServiceToken } from "@/lib/serviceAuth";
import { CONTENT_TYPES, deriveUrl, serializeJsonFields } from "@/lib/content";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const denied = requireServiceToken(req, "CONTENT_INGEST_TOKEN");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const type = String(body.type ?? "");
  const slug = String(body.slug ?? "").trim();
  if (!CONTENT_TYPES.includes(type as never)) {
    return NextResponse.json({ error: "type must be BLOG or LANDING" }, { status: 400 });
  }
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  for (const req of ["primaryKeyword", "metaTitle", "metaDescription", "h1", "funnelStage"]) {
    if (!body[req]) return NextResponse.json({ error: `${req} is required` }, { status: 400 });
  }

  const url = (body.url as string) || deriveUrl(type, slug);
  const data = serializeJsonFields({
    type,
    slug,
    url,
    priority: body.priority ?? null,
    funnelStage: body.funnelStage,
    segment: body.segment ?? null,
    primaryKeyword: body.primaryKeyword,
    secondaryKeywords: body.secondaryKeywords ?? null,
    metaTitle: body.metaTitle,
    metaDescription: body.metaDescription,
    h1: body.h1,
    sectionsPlan: body.sectionsPlan ?? null,
    schemaTypes: body.schemaTypes ?? "Article; FAQPage",
    indexable: body.indexable ?? true,
    guardrails: body.guardrails ?? null,
    answerBlock: body.answerBlock ?? null,
    bodyHtml: body.bodyHtml ?? null,
    sections: body.sections ?? null,
    faq: body.faq ?? null,
    sources: body.sources ?? null,
    videos: body.videos ?? null,
    ctas: body.ctas ?? null,
    ogImageUrl: body.ogImageUrl ?? null,
    inlineImages: body.inlineImages ?? null,
    wordCount: body.wordCount ?? null,
    proofVariant: body.proofVariant ?? null,
    importBatchId: body.importBatchId ?? null,
    agentRunId: body.agentRunId ?? null,
    competitorNotes: body.competitorNotes ?? null,
  }) as Record<string, unknown>;

  const existing = await prisma.contentPage.findUnique({ where: { slug } });
  const locked = ["PUBLISHED", "DISABLED", "ARCHIVED"];
  if (existing && locked.includes(existing.status)) {
    return NextResponse.json(
      { error: `Refusing to overwrite '${slug}' in status ${existing.status}`, id: existing.id },
      { status: 409 }
    );
  }

  const withStatus = { ...data, status: "READY_FOR_REVIEW" };
  const saved = existing
    ? await prisma.contentPage.update({ where: { slug }, data: withStatus })
    : await prisma.contentPage.create({
        // data is validated above (required fields checked); Prisma's create input
        // is stricter than Record<string, unknown>, so cast at the boundary.
        data: withStatus as Parameters<typeof prisma.contentPage.create>[0]["data"],
      });

  logger.info(`[content/ingest] ${existing ? "updated" : "created"} ${type} ${slug} → READY_FOR_REVIEW`);
  return NextResponse.json({ id: saved.id, slug: saved.slug, status: saved.status });
}
