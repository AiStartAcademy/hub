import twilio from "twilio";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifiedTwilioParams } from "@/app/api/webhooks/twilio/_shared";
import { TRANSCRIPT_MAX_LENGTH } from "@/lib/calls/internalApi";
import {
  findContactCallForWebhook,
  isCallSid,
  voiceErrorResponse,
  voiceTwimlResponse,
} from "@/app/api/webhooks/twilio/voice/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Verification performs same-database secret reads and request parsing bounded by this request.
  const verified = await verifiedTwilioParams(req, "voice-transcription");
  if (!verified.ok) {
    return verified.response.status >= 500
      ? voiceErrorResponse("We could not save this transcription right now.", 500)
      : verified.response;
  }

  const callSid = verified.params.CallSid?.trim() ?? "";
  const parentCallSid = verified.params.ParentCallSid?.trim() ?? "";
  const transcript = verified.params.TranscriptionText?.trim() ?? "";
  if (
    !isCallSid(callSid) ||
    (parentCallSid && !isCallSid(parentCallSid)) ||
    !transcript ||
    transcript.length > TRANSCRIPT_MAX_LENGTH
  ) {
    logger.error(
      { callSid, parentCallSid, transcriptLength: transcript.length },
      "[twilio voice transcription] verified request has invalid parameters"
    );
    return voiceErrorResponse("We could not validate this transcription update.", 400);
  }

  try {
    // Correlation and persistence are same-database operations bounded by this webhook request.
    const contactCall = await findContactCallForWebhook({
      callSid,
      parentCallSid: parentCallSid || undefined,
    });
    if (!contactCall) {
      logger.warn(
        { callSid, parentCallSid },
        "[twilio voice transcription] no persisted call matched"
      );
      return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
    }

    await prisma.contactCall.update({
      where: { id: contactCall.id },
      data: { transcript },
    });
    return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
  } catch (error) {
    logger.error(
      { err: error, callSid, parentCallSid },
      "[twilio voice transcription] failed to persist transcript"
    );
    return voiceErrorResponse("We could not save this transcription right now.");
  }
}
