// src/app/api/internal/instructor/tick/route.ts
// Instructor reminder runner. Call it on a schedule (every 15 minutes matches the
// drip job) with the DRIP_CRON_TOKEN bearer token:
//
//   curl -X POST https://hub.example.com/api/internal/instructor/tick \
//     -H "Authorization: Bearer $DRIP_CRON_TOKEN"
//
// Shares the drip token deliberately — same trust domain, one fewer secret to rotate;
// the route path is what distinguishes the job. Safe to call repeatedly or twice at
// once: the InstructorReminderSend unique row prevents double-sends, not the caller.
// GET reports what the next run would consider, without sending anything.

import { NextResponse } from "next/server";
import { requireManagedServiceToken } from "@/lib/serviceAuth";
import { tick, reminderQueueDepth } from "@/lib/instructorReminders";
import { isMailConfigured } from "@/lib/mail";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: HEADERS });

export async function GET(req: Request) {
  const denied = await requireManagedServiceToken(req, "DRIP_CRON_TOKEN");
  if (denied) return denied;

  const now = new Date();
  return json({
    now: now.toISOString(),
    ...(await reminderQueueDepth(now)),
    smtpConfigured: await isMailConfigured(),
  });
}

export async function POST(req: Request) {
  const denied = await requireManagedServiceToken(req, "DRIP_CRON_TOKEN");
  if (denied) return denied;

  try {
    const result = await tick();
    return json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "[instructor/tick] failed");
    return json({ ok: false, error: "Instructor reminder tick failed" }, 500);
  }
}
