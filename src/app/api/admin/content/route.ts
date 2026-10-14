// src/app/api/admin/content/route.ts
// GET — list content for the CMS. Session-auth (admin roles).
//   ?type=BLOG|LANDING   tab filter
//   ?status=<status>     status filter
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { CONTENT_TYPES, deriveUrl, isValidTemplate } from "@/lib/content";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"];

async function requireAdmin() {
  const session = await auth();
  return hasAnyRole(session?.user, ADMIN_ROLES) ? session : null;
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (status) where.status = status;

  const pages = await prisma.contentPage.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    // Summary columns only — the editor fetches the full row by id.
    select: {
      id: true,
      type: true,
      slug: true,
      url: true,
      status: true,
      priority: true,
      funnelStage: true,
      segment: true,
      metaTitle: true,
      wordCount: true,
      reviewedById: true,
      updatedAt: true,
      publishedAt: true,
    },
  });

  return NextResponse.json({ count: pages.length, pages });
}

// POST — create a content page manually from the "New Blog Post / Landing Page"
// form (same fields as the CSV import, plus a template selector). Creates a DRAFT
// the team can then generate (via the agent) or fill in the editor.
export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const type = String(b.type ?? "");
  if (!CONTENT_TYPES.includes(type as never)) {
    return NextResponse.json({ error: "type must be BLOG or LANDING" }, { status: 400 });
  }
  const slug = String(b.slug ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/^blog\//, "");
  for (const [field, val] of [
    ["slug", slug],
    ["primaryKeyword", b.primaryKeyword],
    ["metaTitle", b.metaTitle],
    ["metaDescription", b.metaDescription],
    ["h1", b.h1],
    ["funnelStage", b.funnelStage],
  ] as const) {
    if (!val || !String(val).trim()) {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 });
    }
  }

  const template = String(b.template ?? "default");
  if (!isValidTemplate(type, template)) {
    return NextResponse.json({ error: `Unknown template '${template}' for ${type}` }, { status: 400 });
  }

  const existing = await prisma.contentPage.findUnique({ where: { slug }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: `A page with slug '${slug}' already exists`, id: existing.id }, { status: 409 });
  }

  const created = await prisma.contentPage.create({
    data: {
      type,
      slug,
      url: (b.url as string)?.trim() || deriveUrl(type, slug),
      status: "DRAFT",
      template,
      priority: (b.priority as string) || null,
      funnelStage: String(b.funnelStage),
      segment: (b.segment as string) || null,
      primaryKeyword: String(b.primaryKeyword),
      secondaryKeywords: (b.secondaryKeywords as string) || null,
      metaTitle: String(b.metaTitle),
      metaDescription: String(b.metaDescription),
      h1: String(b.h1),
      sectionsPlan: (b.sectionsPlan as string) || null,
      schemaTypes: (b.schemaTypes as string) || (type === "BLOG" ? "Article; FAQPage" : "Course; FAQPage"),
      indexable: b.indexable === undefined ? true : !!b.indexable,
      guardrails: (b.guardrails as string) || null,
      proofVariant: (b.proofVariant as string) || null,
    },
  });

  logger.info(`[admin/content POST] created ${type} '${slug}' (template=${template})`);
  return NextResponse.json({ id: created.id, slug: created.slug, status: created.status });
}
