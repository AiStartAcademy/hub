// src/app/api/admin/agents/[slug]/route.ts
// PATCH — change status (ENABLED | PAUSED | DISABLED) or settings.
// DELETE — remove the agent (ADMIN only). Runs cascade.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"];
const AGENT_STATUSES = ["ENABLED", "PAUSED", "DISABLED"];

async function getSessionUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!hasAnyRole(await getSessionUser(), ADMIN_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { slug } = await params;
  const body = (await req.json().catch(() => null)) as
    | { status?: string; maxDurationMin?: number; settings?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!AGENT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = body.status;
  }
  if (body.maxDurationMin !== undefined) data.maxDurationMin = body.maxDurationMin;
  if (body.settings !== undefined) {
    data.settings = typeof body.settings === "string" ? body.settings : JSON.stringify(body.settings);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const agent = await prisma.agent.update({ where: { slug }, data }).catch(() => null);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  logger.info(`[admin/agents PATCH] ${slug} → ${agent.status}`);
  return NextResponse.json({ slug: agent.slug, status: agent.status });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!hasRole(await getSessionUser(), "ADMIN")) {
    return NextResponse.json({ error: "Forbidden — ADMIN only" }, { status: 403 });
  }
  const { slug } = await params;
  await prisma.agent.delete({ where: { slug } }).catch(() => null);
  logger.info(`[admin/agents DELETE] ${slug}`);
  return NextResponse.json({ ok: true });
}
