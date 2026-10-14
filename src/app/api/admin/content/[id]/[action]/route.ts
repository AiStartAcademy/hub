// src/app/api/admin/content/[id]/[action]/route.ts
// POST — status transitions: publish | disable | archive. Session-auth.
// Publishing (and disabling) triggers a website rebuild so static pages regenerate.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"];

/** Best-effort: kick the website GitLab pipeline so the static site regenerates. */
async function triggerSiteBuild(reason: string) {
  const url = process.env.SITE_BUILD_TRIGGER_URL;
  const token = process.env.SITE_BUILD_TRIGGER_TOKEN;
  if (!url || !token) {
    console.warn(`[content build] SITE_BUILD_TRIGGER_* not set — skipping rebuild (${reason})`);
    return;
  }
  try {
    const form = new URLSearchParams({ token, ref: "main", "variables[REASON]": reason });
    const res = await fetch(url, { method: "POST", body: form });
    logger.info(`[content build] triggered (${reason}) → ${res.status}`);
  } catch (e) {
    logger.error({ err: e },`[content build] trigger failed (${reason}):`);
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const session = await auth();
  if (!hasAnyRole(session?.user, ADMIN_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, action } = await params;
  const reviewerId = (session?.user as { id?: string })?.id ?? null;
  const page = await prisma.contentPage.findUnique({ where: { id } });
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let data: Record<string, unknown>;
  switch (action) {
    case "publish":
      data = {
        status: "PUBLISHED",
        publishedAt: page.publishedAt ?? new Date(),
        reviewedById: reviewerId,
      };
      break;
    case "disable":
      data = { status: "DISABLED" };
      break;
    case "archive":
      data = { status: "ARCHIVED" };
      break;
    default:
      return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
  }

  const saved = await prisma.contentPage.update({ where: { id }, data });
  logger.info(`[admin/content ${action}] ${page.slug} → ${saved.status}`);

  // Publish and disable both change what the static site should serve.
  if (action === "publish" || action === "disable") {
    await triggerSiteBuild(`${action}:${page.type}:${page.slug}`);
  }

  return NextResponse.json({ id: saved.id, slug: saved.slug, status: saved.status });
}
