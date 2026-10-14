// src/app/api/agents/[slug]/run/route.ts
// POST — "Run now" from the CMS. Session-auth. Creates a QUEUED AgentRun and asks
// the agents service to execute it. The service reports progress back via
// /api/agents/runs/[id].
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await auth();
  if (!hasAnyRole(session?.user, ADMIN_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const agent = await prisma.agent.findUnique({ where: { slug } });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.status !== "ENABLED") {
    return NextResponse.json({ error: `Agent is ${agent.status}` }, { status: 409 });
  }

  const inputs = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const triggeredBy = (session?.user as { id?: string })?.id ?? "admin";

  const run = await prisma.agentRun.create({
    data: { agentId: agent.id, status: "QUEUED", triggeredBy },
  });

  const base = process.env.AGENTS_SERVICE_URL;
  const token = process.env.AGENTS_SERVICE_TOKEN;
  if (!base || !token) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: "AGENTS_SERVICE_URL/TOKEN not configured", finishedAt: new Date() },
    });
    return NextResponse.json({ error: "Agents service not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${base}/agents/${agent.serviceSlug ?? slug}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId: run.id, inputs }),
    });
    if (!res.ok) throw new Error(`service responded ${res.status}: ${await res.text()}`);
    const out = (await res.json().catch(() => ({}))) as { serviceRunId?: string };
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { serviceRunId: out.serviceRunId ?? null },
    });
    logger.info(`[agents/run] dispatched ${slug} runId=${run.id}`);
    return NextResponse.json({ runId: run.id, serviceRunId: out.serviceRunId, status: "QUEUED" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: msg, finishedAt: new Date() },
    });
    logger.error({ err: msg },`[agents/run] dispatch failed for ${slug}:`);
    return NextResponse.json({ runId: run.id, error: msg }, { status: 502 });
  }
}
