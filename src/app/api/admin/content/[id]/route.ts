// src/app/api/admin/content/[id]/route.ts
// GET (full row, decoded JSON) · PATCH (edit) · DELETE (hard-delete, ADMIN only).
// Session-auth. Status transitions live in ./[action]/route.ts.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { parseJsonFields, serializeJsonFields } from "@/lib/content";
import { hasRole, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"];

async function getSessionUser() {
  const session = await auth();
  return session?.user ?? null;
}

// Fields an editor may change. Status is intentionally excluded (use transitions).
const EDITABLE = new Set([
  "metaTitle", "metaDescription", "h1", "segment", "primaryKeyword",
  "secondaryKeywords", "sectionsPlan", "schemaTypes", "indexable", "guardrails",
  "answerBlock", "bodyHtml", "sections", "faq", "sources", "videos", "ctas",
  "ogImageUrl", "inlineImages", "wordCount", "proofVariant", "authorName", "priority",
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!hasAnyRole(await getSessionUser(), ADMIN_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const page = await prisma.contentPage.findUnique({ where: { id } });
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(parseJsonFields(page as unknown as Record<string, unknown>));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!hasAnyRole(await getSessionUser(), ADMIN_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) data[k] = v;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }
  // Editing an already-approved draft moves it back into review.
  const current = await prisma.contentPage.findUnique({ where: { id }, select: { status: true } });
  if (current?.status === "READY_FOR_REVIEW") data.status = "IN_REVIEW";

  const saved = await prisma.contentPage.update({
    where: { id },
    data: serializeJsonFields(data),
  });
  logger.info(`[admin/content PATCH] ${id} fields=[${Object.keys(data).join(",")}]`);
  return NextResponse.json({ id: saved.id, status: saved.status, updatedAt: saved.updatedAt });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Hard delete is ADMIN-only; the soft-delete path is the "archive" transition.
  if (!hasRole(await getSessionUser(), "ADMIN")) {
    return NextResponse.json({ error: "Forbidden — ADMIN only" }, { status: 403 });
  }
  const { id } = await params;
  await prisma.contentPage.delete({ where: { id } });
  logger.info(`[admin/content DELETE] hard-deleted ${id}`);
  return NextResponse.json({ ok: true });
}
