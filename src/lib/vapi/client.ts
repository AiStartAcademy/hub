// src/lib/vapi/client.ts
//
// Thin server-side client for Vapi outbound voice calls. One entry point,
// initiateCall(), used by both the drip CALL channel (engine.ts) and the
// lead-profile "Call with AI" button. Creates the ContactCall row in the same
// call so an end-of-call webhook always has something to attach to.
//
// Secrets (Settings → Integrations, category "comms", env fallback):
//   VAPI_API_KEY              — private API key
//   VAPI_PHONE_NUMBER_ID      — the Vapi phone number that places calls
//   VAPI_DEFAULT_ASSISTANT_ID — assistant used when a step doesn't override
//   VAPI_WEBHOOK_SECRET       — checked by /api/webhooks/vapi (not used here)
//
// The assistant itself (prompt, analysisPlan, transferCall tool to a human)
// is configured in the Vapi dashboard — the hub only references it by id.

import prisma from "@/lib/prisma";
import { getSecret } from "@/lib/secrets";
import { normalizePhoneE164 } from "@/lib/phone";
import { logger } from "@/lib/logger";

const VAPI_BASE_URL = "https://api.vapi.ai";

export type InitiateCallInput = {
  contactId: string;
  /** Raw phone; normalized to E.164 here — throws if invalid. */
  phone: string;
  contactName?: string | null;
  /** Override the default assistant (DripStep.callAssistantId). */
  assistantId?: string | null;
  /** Override the assistant's opening line (DripStep.callFirstMessage). */
  firstMessage?: string | null;
  /** Drip ledger row that placed this call; null for manual/one-off calls. */
  dripSendId?: string | null;
  /** Staff who initiated (profile button); null for drip automation. */
  authorId?: string | null;
  authorLabel?: string | null;
};

export type InitiateCallResult = {
  contactCallId: string;
  providerCallId: string;
};

/**
 * Place an outbound AI call via Vapi and record it as a ContactCall(INITIATED).
 * Throws on invalid phone, missing configuration, or a Vapi API error —
 * callers decide how to ledger the failure (drip marks the DripSend FAILED).
 *
 * NOTE: consent/do-not-call gating is the caller's job (callabilityReason()).
 * This function only refuses numbers it cannot dial.
 */
export async function initiateCall(input: InitiateCallInput): Promise<InitiateCallResult> {
  const number = normalizePhoneE164(input.phone);
  if (!number) throw new Error(`Not a dialable E.164 phone: ${input.phone}`);

  const [apiKey, phoneNumberId, defaultAssistantId] = await Promise.all([
    getSecret("VAPI_API_KEY"),
    getSecret("VAPI_PHONE_NUMBER_ID"),
    getSecret("VAPI_DEFAULT_ASSISTANT_ID"),
  ]);
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured");
  if (!phoneNumberId) throw new Error("VAPI_PHONE_NUMBER_ID is not configured");
  const assistantId = input.assistantId || defaultAssistantId;
  if (!assistantId) throw new Error("No Vapi assistant configured (VAPI_DEFAULT_ASSISTANT_ID)");

  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { name: true },
  });
  const customerName = input.contactName ?? contact?.name ?? undefined;
  const firstName = customerName?.split(/\s+/)[0];

  const payload: Record<string, unknown> = {
    assistantId,
    phoneNumberId,
    customer: { number, ...(customerName ? { name: customerName } : {}) },
    // Comes back verbatim on webhook events — the fallback correlation key if
    // the end-of-call report ever races the providerCallId write below.
    metadata: {
      hubContactId: input.contactId,
      hubDripSendId: input.dripSendId ?? null,
    },
    assistantOverrides: {
      ...(input.firstMessage ? { firstMessage: input.firstMessage } : {}),
      variableValues: {
        contactName: customerName ?? "",
        firstName: firstName ?? "",
      },
    },
  };

  const res = await fetch(`${VAPI_BASE_URL}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Vapi call create failed (${res.status}): ${detail.slice(0, 500)}`);
  }
  const call = (await res.json()) as { id?: string };
  if (!call.id) throw new Error("Vapi call create returned no call id");

  const record = await prisma.contactCall.create({
    data: {
      contactId: input.contactId,
      dripSendId: input.dripSendId ?? null,
      provider: "vapi",
      providerCallId: call.id,
      direction: "OUTBOUND",
      status: "INITIATED",
      assistantId,
      phoneNumber: number,
      authorId: input.authorId ?? null,
      authorLabel: input.authorLabel ?? null,
      startedAt: new Date(),
    },
  });
  logger.info(
    { contactId: input.contactId, providerCallId: call.id, dripSendId: input.dripSendId ?? null },
    "[vapi] outbound call initiated"
  );
  return { contactCallId: record.id, providerCallId: call.id };
}

/** Map a Vapi endedReason to our ContactCall.status machine. */
export function statusFromEndedReason(endedReason: string | undefined | null): string {
  const reason = (endedReason ?? "").toLowerCase();
  if (!reason) return "COMPLETED";
  if (reason.includes("transfer") || reason.includes("forwarded")) return "TRANSFERRED";
  if (reason.includes("voicemail")) return "VOICEMAIL";
  if (
    reason.includes("no-answer") ||
    reason.includes("did-not-answer") ||
    reason.includes("busy") ||
    reason.includes("customer-did-not-answer")
  )
    return "NO_ANSWER";
  if (
    reason.includes("error") ||
    reason.includes("failed") ||
    reason.includes("invalid") ||
    reason.includes("rejected")
  )
    return "FAILED";
  return "COMPLETED";
}
