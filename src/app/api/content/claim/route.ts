// src/app/api/content/claim/route.ts
// POST — the blog/landing agent claims DRAFT rows to work on. Bearer CONTENT_INGEST_TOKEN.
// Atomically flips claimed rows DRAFT → GENERATING so two runs can't grab the same topic.
// Body: { type: "BLOG"|"LANDING", count?: number, slug?: string }
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServiceToken } from "@/lib/serviceAuth";
import { CONTENT_TYPES } from "@/lib/content";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const denied = requireServiceToken(req, "CONTENT_INGEST_TOKEN");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { type?: string; count?: number; slug?: string }
    | null;
  if (!body?.type || !CONTENT_TYPES.includes(body.type as never)) {
    return NextResponse.json({ error: "type must be BLOG or LANDING" }, { status: 400 });
  }
  const count = Math.min(Math.max(body.count ?? 1, 1), 10);

  const candidates = await prisma.contentPage.findMany({
    where: { type: body.type, status: "DRAFT", ...(body.slug ? { slug: body.slug } : {}) },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: count,
  });

  const claimed: typeof candidates = [];
  for (const c of candidates) {
    // Guard on status so a concurrent claim can't double-grab the row.
    const res = await prisma.contentPage.updateMany({
      where: { id: c.id, status: "DRAFT" },
      data: { status: "GENERATING" },
    });
    if (res.count === 1) claimed.push(c);
  }

  logger.info(`[content/claim] ${body.type} claimed ${claimed.length}/${candidates.length}`);
  return NextResponse.json({
    claimed: claimed.map((c) => ({
      id: c.id,
      slug: c.slug,
      type: c.type,
      url: c.url,
      primaryKeyword: c.primaryKeyword,
      secondaryKeywords: c.secondaryKeywords,
      metaTitle: c.metaTitle,
      metaDescription: c.metaDescription,
      h1: c.h1,
      funnelStage: c.funnelStage,
      segment: c.segment,
      sectionsPlan: c.sectionsPlan,
      schemaTypes: c.schemaTypes,
      guardrails: c.guardrails,
    })),
  });
}
