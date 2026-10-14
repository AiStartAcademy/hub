// POST /api/webhooks/vapi — Vapi server URL endpoint.
//
// Receives status-update and end-of-call-report messages for calls placed by
// src/lib/vapi/client.ts and finalizes the matching ContactCall row (status,
// transcript, recording, analysis). Structured call data is read from both
// Vapi sources — the legacy `analysis.structuredData` (analysisPlan) and the
// dashboard's `artifact.structuredOutputs` — via lib/vapi/structuredData.
// Auth: Vapi sends the configured server
// secret verbatim in the `x-vapi-secret` header; we compare timing-safe
// against the managed VAPI_WEBHOOK_SECRET.
//
// Always answers 200 for well-authed messages we can't correlate — Vapi
// retries on non-2xx and an unknown call id will never become known.

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/prisma";
import { getSecret } from "@/lib/secrets";
import { statusFromEndedReason } from "@/lib/vapi/client";
import { extractStructuredData } from "@/lib/vapi/structuredData";
import { logger } from "@/lib/logger";
import {
  createInboundVapiContactCall,
  inboundVapiCallPlan,
} from "@/lib/calls/inboundContact";

export const dynamic = "force-dynamic";

function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

type VapiMessage = {
  type?: string;
  status?: string;
  endedReason?: string;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  durationSeconds?: number;
  startedAt?: string;
  endedAt?: string;
  analysis?: {
    summary?: string;
    structuredData?: Record<string, unknown>;
    successEvaluation?: unknown;
  };
  artifact?: {
    transcript?: string;
    recordingUrl?: string;
    structuredOutputs?: Record<string, { name?: string; result?: unknown }>;
  };
  call?: {
    id?: string;
    type?: string;
    customer?: {
      number?: unknown;
    };
    metadata?: Record<string, unknown>;
  };
};

export async function POST(req: Request) {
  const expected = await getSecret("VAPI_WEBHOOK_SECRET");
  if (!expected) {
    logger.error("[vapi webhook] VAPI_WEBHOOK_SECRET is not set — refusing request");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const provided = req.headers.get("x-vapi-secret") ?? "";
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let message: VapiMessage;
  try {
    const body = (await req.json()) as { message?: VapiMessage };
    message = body.message ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerCallId = message.call?.id;
  if (typeof providerCallId !== "string" || !providerCallId) {
    return NextResponse.json({ ok: true, skipped: "no call id" });
  }

  // Correlate: primary key is the provider call id written at initiation;
  // metadata is the fallback if the report ever races that write.
  let call = await prisma.contactCall.findUnique({ where: { providerCallId } });
  if (!call) {
    const dripSendId = message.call?.metadata?.hubDripSendId;
    if (typeof dripSendId === "string" && dripSendId) {
      call = await prisma.contactCall.findUnique({ where: { dripSendId } });
    }
  }
  if (!call) {
    const plan = inboundVapiCallPlan(message);
    if (plan.action === "skip") {
      logger.warn(
        { providerCallId, type: message.type, reason: plan.reason },
        "[vapi webhook] unknown call id skipped"
      );
      return NextResponse.json({ ok: true, skipped: plan.reason });
    }
    call = await createInboundVapiContactCall(plan);
  }

  if (message.type === "status-update") {
    const map: Record<string, string> = {
      ringing: "RINGING",
      "in-progress": "IN_PROGRESS",
    };
    const next = map[(message.status ?? "").toLowerCase()];
    // Never regress a finalized row (duplicate/out-of-order deliveries).
    const terminal = ["COMPLETED", "NO_ANSWER", "VOICEMAIL", "FAILED", "TRANSFERRED"];
    if (next && !terminal.includes(call.status)) {
      await prisma.contactCall.update({ where: { id: call.id }, data: { status: next } });
    }
    return NextResponse.json({ ok: true });
  }

  if (message.type === "end-of-call-report") {
    const structured = extractStructuredData(message);
    const status = statusFromEndedReason(message.endedReason);
    const outcome =
      structured && typeof structured["outcome"] === "string"
        ? (structured["outcome"] as string)
        : null;
    const transferredTo =
      structured && typeof structured["transferred_to"] === "string"
        ? (structured["transferred_to"] as string)
        : null;

    await prisma.contactCall.update({
      where: { id: call.id },
      data: {
        status,
        endedReason: message.endedReason ?? null,
        outcome,
        transcript: message.artifact?.transcript ?? message.transcript ?? null,
        recordingUrl: message.artifact?.recordingUrl ?? message.recordingUrl ?? null,
        summary: message.analysis?.summary ?? message.summary ?? null,
        analysis: structured ? JSON.stringify(structured) : null,
        durationSec:
          typeof message.durationSeconds === "number"
            ? Math.round(message.durationSeconds)
            : null,
        transferredTo,
        startedAt: message.startedAt ? new Date(message.startedAt) : call.startedAt,
        endedAt: message.endedAt ? new Date(message.endedAt) : new Date(),
      },
    });

    // Honor an in-call "please don't call me" — the assistant sets
    // requested_dnc via its analysisPlan or a Structured Output.
    if (structured && structured["requested_dnc"] === true) {
      await prisma.contact.update({
        where: { id: call.contactId },
        data: { doNotCall: true },
      });
      logger.info({ contactId: call.contactId }, "[vapi webhook] lead requested do-not-call");
    }

    await prisma.contact.update({
      where: { id: call.contactId },
      data: { lastActivityAt: new Date() },
    });

    logger.info(
      { providerCallId, status, outcome, durationSec: message.durationSeconds },
      "[vapi webhook] call finalized"
    );
    return NextResponse.json({ ok: true });
  }

  // Other message types (transcripts in flight, tool calls, etc.) — ack.
  return NextResponse.json({ ok: true, skipped: message.type ?? "unknown type" });
}
