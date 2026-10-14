// src/app/api/content/published/route.ts
// GET — the website build generator fetches publishable rows (bearer SITE_BUILD_TOKEN).
// Returns PUBLISHED rows plus DISABLED rows (so the generator can emit 410/redirects).
//   ?type=BLOG|LANDING   filter by type
//   ?since=<ISO>         only rows updated since (incremental builds)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServiceToken } from "@/lib/serviceAuth";
import { parseJsonFields } from "@/lib/content";

export async function GET(req: Request) {
  const denied = requireServiceToken(req, "SITE_BUILD_TOKEN");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const since = searchParams.get("since");

  const where: Record<string, unknown> = { status: { in: ["PUBLISHED", "DISABLED"] } };
  if (type) where.type = type;
  if (since) {
    const d = new Date(since);
    if (!isNaN(d.getTime())) where.updatedAt = { gt: d };
  }

  const rows = await prisma.contentPage.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    count: rows.length,
    generatedAt: new Date().toISOString(),
    pages: rows.map((r) => parseJsonFields(r as unknown as Record<string, unknown>)),
  });
}
