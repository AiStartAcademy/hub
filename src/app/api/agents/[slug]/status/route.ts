// src/app/api/agents/[slug]/status/route.ts
// GET — the kill switch. The agents service calls this before dispatching a
// (manual or scheduled) run and aborts unless status is ENABLED. Bearer
// AGENT_REPORT_TOKEN.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireServiceToken } from "@/lib/serviceAuth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const denied = requireServiceToken(req, "AGENT_REPORT_TOKEN");
  if (denied) return denied;

  const { slug } = await params;
  const agent = await prisma.agent.findUnique({
    where: { slug },
    select: { slug: true, status: true, maxDurationMin: true, settings: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  return NextResponse.json({
    slug: agent.slug,
    status: agent.status,
    enabled: agent.status === "ENABLED",
    maxDurationMin: agent.maxDurationMin,
    settings: agent.settings ? safeParse(agent.settings) : null,
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
