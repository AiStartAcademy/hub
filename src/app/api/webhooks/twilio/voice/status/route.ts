import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifiedTwilioParams } from "@/app/api/webhooks/twilio/_shared";
import {
  findContactCallForWebhook,
  isCallSid,
  isContactCallId,
  isTerminalCallStatus,
  voiceErrorResponse,
  voiceTwimlResponse,
} from "@/app/api/webhooks/twilio/voice/_shared";
import twilio from "twilio";

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<string, string> = {
  ringing: "RINGING",
  "in-progress": "IN_PROGRESS",
  completed: "COMPLETED",
  busy: "NO_ANSWER",
  "no-answer": "NO_ANSWER",
  failed: "FAILED",
  canceled: "FAILED",
};

function parseDuration(value: string | undefined): number | null | "invalid" {
  if (value === undefined || value.trim() === "") return null;
  if (!/^\d{1,9}$/.test(value.trim())) return "invalid";
  const duration = Number(value);
  return Number.isSafeInteger(duration) ? duration : "invalid";
}

export async function POST(req: Request): Promise<Response> {
  // Verification performs same-database secret reads and request parsing bounded by this request.
  const verified = await verifiedTwilioParams(req, "voice-status");
  if (!verified.ok) {
    return verified.response.status >= 500
      ? voiceErrorResponse("We could not update this call right now.", 500)
      : verified.response;
  }

  const url = new URL(req.url);
  const contactCallId = url.searchParams.get("contactCallId")?.trim() ?? "";
  const callSid = verified.params.CallSid?.trim() ?? "";
  const parentCallSid = verified.params.ParentCallSid?.trim() ?? "";
  const callStatus = verified.params.CallStatus?.trim().toLowerCase() ?? "";
  const duration = parseDuration(verified.params.CallDuration);

  if (
    (contactCallId && !isContactCallId(contactCallId)) ||
    (!contactCallId && !isCallSid(callSid) && !isCallSid(parentCallSid)) ||
    (callSid && !isCallSid(callSid)) ||
    (parentCallSid && !isCallSid(parentCallSid)) ||
    (callStatus !== "initiated" && !STATUS_MAP[callStatus]) ||
    duration === "invalid"
  ) {
    logger.error(
      { contactCallId, callSid, parentCallSid, callStatus },
      "[twilio voice status] verified request has invalid parameters"
    );
    return voiceErrorResponse("We could not validate this call update.", 400);
  }

  try {
    // Twilio's initiated event confirms the status already written when the call row was created.
    if (callStatus === "initiated") {
      return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
    }

    // Correlation and persistence are same-database operations bounded by this webhook request.
    const contactCall = await findContactCallForWebhook({
      contactCallId: contactCallId || undefined,
      callSid: callSid || undefined,
      parentCallSid: parentCallSid || undefined,
    });
    if (!contactCall) {
      logger.warn(
        { contactCallId, callSid, parentCallSid, callStatus },
        "[twilio voice status] no persisted call matched"
      );
      return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
    }

    const nextStatus = STATUS_MAP[callStatus];
    if (!nextStatus) {
      throw new Error(`Validated Twilio CallStatus ${callStatus} has no internal mapping`);
    }

    if (!isTerminalCallStatus(contactCall.status) || contactCall.status === nextStatus) {
      const terminalStatuses = [
        "COMPLETED",
        "NO_ANSWER",
        "VOICEMAIL",
        "FAILED",
        "TRANSFERRED",
      ];
      await prisma.contactCall.updateMany({
        where: {
          id: contactCall.id,
          OR: [{ status: { notIn: terminalStatuses } }, { status: nextStatus }],
        },
        data: {
          status: nextStatus,
          ...(callStatus === "completed" && duration !== null ? { durationSec: duration } : {}),
          ...(isTerminalCallStatus(nextStatus) ? { endedAt: new Date() } : {}),
        },
      });
    } else {
      logger.info(
        { contactCallId: contactCall.id, currentStatus: contactCall.status, nextStatus },
        "[twilio voice status] ignored out-of-order update for terminal call"
      );
    }

    return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
  } catch (error) {
    logger.error(
      { err: error, contactCallId, callSid, parentCallSid, callStatus },
      "[twilio voice status] failed to persist call status"
    );
    return voiceErrorResponse("We could not update this call right now.");
  }
}
