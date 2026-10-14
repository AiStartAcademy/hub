// src/app/api/agents/runs/[id]/route.ts
// POST — the agents service reports run lifecycle here (start/progress/finish).
// Bearer AGENT_REPORT_TOKEN. GET returns the run (session-auth) for the CMS.
// NOTE: the static segment "runs" takes precedence over the sibling [slug]
// dynamic route in Next.js, so /api/agents/runs/<id> resolves here.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { requireServiceToken } from "@/lib/serviceAuth";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELLED", "TIMED_OUT"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireServiceToken(req, "AGENT_REPORT_TOKEN");
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  if (body.status && !RUN_STATUSES.includes(String(body.status))) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.serviceRunId !== undefined) data.serviceRunId = body.serviceRunId;
  if (body.itemsProduced !== undefined) data.itemsProduced = body.itemsProduced;
  if (body.costUsd !== undefined) data.costUsd = body.costUsd;
  if (body.logTail !== undefined) data.logTail = String(body.logTail).slice(-8000);
  if (body.error !== undefined) data.error = body.error;
  if (body.status === "RUNNING") data.startedAt = new Date();
  if (["SUCCESS", "FAILED", "CANCELLED", "TIMED_OUT"].includes(String(body.status))) {
    data.finishedAt = new Date();
  }

  const run = await prisma.agentRun.update({ where: { id }, data }).catch(() => null);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  logger.info(`[agents/runs] ${id} → ${run.status}`);
  return NextResponse.json({ id: run.id, status: run.status });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const run = await prisma.agentRun.findUnique({ where: { id }, include: { agent: true } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(run);
}
