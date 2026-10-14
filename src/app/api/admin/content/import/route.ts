// src/app/api/admin/content/import/route.ts
// POST — import roadmap rows as DRAFT ContentPages + one ImportBatch log row.
// The admin UI parses the CSV in the browser and POSTs { type, source, rows: [...] }
// (keeps a CSV-parser dependency out of the server). Idempotent on slug:
// existing rows have only roadmap/SEO metadata refreshed — generated content and
// human edits are never touched.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { CONTENT_TYPES, deriveUrl } from "@/lib/content";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"];

// Maps the roadmap spreadsheet headers → ContentPage columns.
function fromCsvRow(type: string, row: Record<string, string>) {
  const slug =
    (row.slug || row["Recommended URL"] || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/^blog\//, "")
      .split("/")
      .filter(Boolean)
      .pop() || "";
  return {
    type,
    slug,
    url: row["Recommended URL"]?.trim() || deriveUrl(type, slug),
    priority: row.Priority || null,
    funnelStage: row["Funnel Stage"] || "Awareness",
    segment: row.Segment || null,
    primaryKeyword: row["Primary Keyword"] || "",
    secondaryKeywords: row["Secondary Keywords"] || null,
    metaTitle: row["Meta Title"] || "",
    metaDescription: row["Meta Description"] || "",
    h1: row.H1 || "",
    sectionsPlan: row["Recommended H2 / Page Sections"] || row["Recommended H2 / Sections"] || null,
    schemaTypes: row.Schema || "Article; FAQPage",
    indexable: (row["Index?"] || "index").toLowerCase() !== "noindex",
    guardrails: row["Notes / Guardrails"] || null,
    proofVariant: row["Proof variant"] || null,
  };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!hasAnyRole(session?.user, ADMIN_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const createdById = (session?.user as { id?: string })?.id ?? null;

  const body = (await req.json().catch(() => null)) as
    | { type?: string; source?: string; rows?: Record<string, string>[] }
    | null;
  if (!body?.type || !CONTENT_TYPES.includes(body.type as never)) {
    return NextResponse.json({ error: "type must be BLOG or LANDING" }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "rows[] is required" }, { status: 400 });
  }

  let created = 0;
  let skipped = 0;
  for (const raw of body.rows) {
    const mapped = fromCsvRow(body.type, raw);
    if (!mapped.slug || !mapped.primaryKeyword) {
      skipped++;
      continue;
    }
    const existing = await prisma.contentPage.findUnique({
      where: { slug: mapped.slug },
      select: { id: true },
    });
    if (existing) {
      // Refresh roadmap/SEO metadata only; never touch content or status.
      const { type: _t, slug: _s, ...meta } = mapped;
      await prisma.contentPage.update({ where: { slug: mapped.slug }, data: meta });
      skipped++;
    } else {
      await prisma.contentPage.create({ data: { ...mapped, status: "DRAFT" } });
      created++;
    }
  }

  const batch = await prisma.importBatch.create({
    data: {
      type: body.type,
      source: body.source || "csv-upload",
      rowCount: body.rows.length,
      createdRows: created,
      skippedRows: skipped,
      createdById,
    },
  });

  logger.info(`[content import] ${body.type} source=${batch.source} created=${created} skipped=${skipped}`);
  return NextResponse.json({ batchId: batch.id, created, skipped, total: body.rows.length });
}
