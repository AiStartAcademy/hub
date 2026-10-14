import twilio from "twilio";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifiedTwilioParams } from "@/app/api/webhooks/twilio/_shared";
import {
  findContactCallForWebhook,
  isCallSid,
  voiceErrorResponse,
  voiceTwimlResponse,
} from "@/app/api/webhooks/twilio/voice/_shared";

export const dynamic = "force-dynamic";

const RECORDING_SID_PATTERN = /^RE[0-9a-f]{32}$/i;

function parseDuration(value: string | undefined): number | null | "invalid" {
  if (value === undefined || value.trim() === "") return null;
  if (!/^\d{1,9}$/.test(value.trim())) return "invalid";
  const duration = Number(value);
  return Number.isSafeInteger(duration) ? duration : "invalid";
}

export async function POST(req: Request): Promise<Response> {
  // Verification performs same-database secret reads and request parsing bounded by this request.
  const verified = await verifiedTwilioParams(req, "voice-recording");
  if (!verified.ok) {
    return verified.response.status >= 500
      ? voiceErrorResponse("We could not save this recording right now.", 500)
      : verified.response;
  }

  const recordingSid = verified.params.RecordingSid?.trim() ?? "";
  const callSid = verified.params.CallSid?.trim() ?? "";
  const parentCallSid = verified.params.ParentCallSid?.trim() ?? "";
  const duration = parseDuration(verified.params.RecordingDuration);
  if (
    !RECORDING_SID_PATTERN.test(recordingSid) ||
    !isCallSid(callSid) ||
    (parentCallSid && !isCallSid(parentCallSid)) ||
    duration === "invalid"
  ) {
    logger.error(
      { recordingSid, callSid, parentCallSid },
      "[twilio voice recording] verified request has invalid parameters"
    );
    return voiceErrorResponse("We could not validate this recording update.", 400);
  }

  try {
    // Correlation and persistence are same-database operations bounded by this webhook request.
    const contactCall = await findContactCallForWebhook({
      callSid,
      parentCallSid: parentCallSid || undefined,
    });
    if (!contactCall) {
      logger.warn(
        { recordingSid, callSid, parentCallSid },
        "[twilio voice recording] no persisted call matched"
      );
      return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
    }

    await prisma.contactCall.update({
      where: { id: contactCall.id },
      data: {
        recordingUrl: `/api/twilio/recordings/${recordingSid}`,
        ...(duration !== null ? { durationSec: duration } : {}),
      },
    });
    if (contactCall.status === "NO_ANSWER") {
      // The conditional update makes retries safe and prevents a later callback from
      // replacing a different terminal outcome with VOICEMAIL.
      await prisma.contactCall.updateMany({
        where: { id: contactCall.id, status: "NO_ANSWER" },
        data: { status: "VOICEMAIL", endedAt: contactCall.endedAt ?? new Date() },
      });
    }

    return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
  } catch (error) {
    logger.error(
      { err: error, recordingSid, callSid, parentCallSid },
      "[twilio voice recording] failed to persist recording"
    );
    return voiceErrorResponse("We could not save this recording right now.");
  }
}
