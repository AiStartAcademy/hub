// src/app/api/internal/drip/tick/route.ts
// The drip runner's only entry point. Call it on a schedule (every 15 minutes is
// the intended cadence) with the DRIP_CRON_TOKEN bearer token:
//
//   curl -X POST https://hub.example.com/api/internal/drip/tick \
//     -H "Authorization: Bearer $DRIP_CRON_TOKEN"
//
// Safe to call more often, and safe to call twice concurrently — the DripSend
// unique constraint is what prevents double-sends, not the caller's discipline.
// GET returns queue depth without sending anything, for monitoring.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireManagedServiceToken } from "@/lib/serviceAuth";
import { tick } from "@/lib/drip/engine";
import { isMailConfigured } from "@/lib/mail";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: HEADERS });

export async function GET(req: Request) {
  const denied = await requireManagedServiceToken(req, "DRIP_CRON_TOKEN");
  if (denied) return denied;

  const now = new Date();
  const [activeCampaigns, activeEnrollments, due, failedSends] = await Promise.all([
    prisma.dripCampaign.count({ where: { status: "ACTIVE" } }),
    prisma.dripEnrollment.count({ where: { status: "ACTIVE" } }),
    prisma.dripEnrollment.count({
      where: { status: "ACTIVE", nextRunAt: { lte: now } },
    }),
    prisma.dripSend.count({ where: { status: "FAILED" } }),
  ]);

  return json({
    now: now.toISOString(),
    activeCampaigns,
    activeEnrollments,
    dueNow: due,
    failedSends,
    smtpConfigured: await isMailConfigured(),
  });
}

export async function POST(req: Request) {
  const denied = await requireManagedServiceToken(req, "DRIP_CRON_TOKEN");
  if (denied) return denied;

  let sendLimit: number | undefined;
  let skipEnroll = false;
  try {
    const body = (await req.json()) as { sendLimit?: unknown; skipEnroll?: unknown };
    if (typeof body?.sendLimit === "number" && Number.isFinite(body.sendLimit)) {
      sendLimit = Math.min(500, Math.max(1, Math.floor(body.sendLimit)));
    }
    skipEnroll = body?.skipEnroll === true;
  } catch {
    // No body is the normal case for a cron call.
  }

  try {
    const result = await tick({ sendLimit, skipEnroll });
    // Surface a partial failure as 207 so a cron monitor notices without treating
    // the whole tick — which may have delivered dozens of emails — as a failure.
    return json(result, result.failed > 0 ? 207 : 200);
  } catch (error) {
    logger.error({ err: error }, "[drip/tick] run failed");
    return json({ error: "Drip tick failed" }, 500);
  }
}
