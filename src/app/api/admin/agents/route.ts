// src/app/api/admin/agents/route.ts
// GET  — list agents with their latest run + a computed health badge.
// POST — sync the registry from the agents service (/agents manifests).
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

const ADMIN_ROLES = ["ADMIN", "TEAM_MEMBER"];

async function requireAdmin() {
  const session = await auth();
  return hasAnyRole(session?.user, ADMIN_ROLES) ? session : null;
}

type Run = { status: string; startedAt: Date | null; finishedAt: Date | null; createdAt: Date } | undefined;

// Derived health — honest for CI/child-process agents (no always-on ping).
function health(status: string, maxDurationMin: number, last: Run): string {
  if (status !== "ENABLED") return "disabled";
  if (!last) return "idle";
  if (last.status === "RUNNING") {
    const started = (last.startedAt ?? last.createdAt).getTime();
    const overdue = Date.now() - started > maxDurationMin * 60_000;
    return overdue ? "stuck" : "running";
  }
  if (last.status === "FAILED" || last.status === "TIMED_OUT") return "failing";
  if (last.status === "SUCCESS") return "healthy";
  return "idle";
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const agents = await prisma.agent.findMany({
    orderBy: { name: "asc" },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return NextResponse.json({
    agents: agents.map((a) => {
      const last = a.runs[0];
      return {
        id: a.id,
        slug: a.slug,
        name: a.name,
        description: a.description,
        status: a.status,
        triggerType: a.triggerType,
        schedule: a.schedule,
        maxDurationMin: a.maxDurationMin,
        health: health(a.status, a.maxDurationMin, last),
        lastRun: last
          ? {
              id: last.id,
              status: last.status,
              itemsProduced: last.itemsProduced,
              costUsd: last.costUsd,
              error: last.error,
              logTail: last.logTail,
              startedAt: last.startedAt,
              finishedAt: last.finishedAt,
              createdAt: last.createdAt,
            }
          : null,
      };
    }),
  });
}

export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const base = process.env.AGENTS_SERVICE_URL;
  const token = process.env.AGENTS_SERVICE_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: "AGENTS_SERVICE_URL/TOKEN not configured" }, { status: 500 });
  }

  let manifests: Array<{ slug: string; name: string; description: string; triggerType?: string; schedule?: string }>;
  try {
    const res = await fetch(`${base}/agents`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`service responded ${res.status}`);
    manifests = ((await res.json()) as { agents: typeof manifests }).agents ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Sync failed: ${msg}` }, { status: 502 });
  }

  let synced = 0;
  for (const m of manifests) {
    await prisma.agent.upsert({
      where: { slug: m.slug },
      create: {
        slug: m.slug,
        serviceSlug: m.slug,
        name: m.name,
        description: m.description,
        triggerType: m.triggerType ?? "manual",
        schedule: m.schedule ?? null,
      },
      // Refresh descriptive fields only; never flip an operator's status.
      update: {
        name: m.name,
        description: m.description,
        triggerType: m.triggerType ?? "manual",
        schedule: m.schedule ?? null,
        serviceSlug: m.slug,
      },
    });
    synced++;
  }
  logger.info(`[admin/agents sync] upserted ${synced} agent(s)`);
  return NextResponse.json({ synced });
}
