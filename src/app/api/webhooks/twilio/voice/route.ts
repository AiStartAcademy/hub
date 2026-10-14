import twilio from "twilio";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { appUrl } from "@/lib/drip/engine";
import { CRM_STAFF_ROLES } from "@/lib/adminGuard";
import { hasAnyRole } from "@/lib/roles";
import { normalizePhoneE164 } from "@/lib/phone";
import { getTwilioNumber } from "@/lib/twilio/client";
import { verifiedTwilioParams } from "@/app/api/webhooks/twilio/_shared";
import {
  CLOSER_IDENTITY_PATTERN,
  isCallSid,
  isContactCallId,
  voiceErrorResponse,
  voiceTwimlResponse,
} from "@/app/api/webhooks/twilio/voice/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Verification performs same-database secret reads and request-body parsing bounded by this request.
  const verified = await verifiedTwilioParams(req, "outbound-voice");
  if (!verified.ok) {
    return verified.response.status >= 500
      ? voiceErrorResponse("We cannot connect your call right now. Please try again later.", 500)
      : verified.response;
  }

  const callSid = verified.params.CallSid?.trim() ?? "";
  const from = verified.params.From?.trim() ?? "";
  const contactId = verified.params.contactId?.trim() ?? "";
  const identityMatch = CLOSER_IDENTITY_PATTERN.exec(from);

  if (!isCallSid(callSid) || !identityMatch || !isContactCallId(contactId)) {
    logger.error(
      { callSid, from, contactId },
      "[twilio outbound voice] verified request has invalid required parameters"
    );
    return voiceErrorResponse("We could not validate this call. Please return to the lead and try again.");
  }

  const userId = identityMatch[1];
  try {
    // These independent Prisma reads are bounded by the webhook request lifetime.
    const [user, contact] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, roles: true },
      }),
      prisma.contact.findUnique({
        where: { id: contactId },
        select: { id: true, phone: true },
      }),
    ]);
    if (!user || !hasAnyRole(user, CRM_STAFF_ROLES)) {
      logger.warn({ callSid, userId }, "[twilio outbound voice] closer identity is not CRM staff");
      return voiceErrorResponse("Your account is not authorized to place this call.");
    }
    if (!contact) {
      logger.warn({ callSid, contactId }, "[twilio outbound voice] lead was not found");
      return voiceErrorResponse("This lead could not be found.");
    }

    const phoneNumber = normalizePhoneE164(contact.phone);
    if (!phoneNumber) {
      logger.warn({ callSid, contactId }, "[twilio outbound voice] lead phone is invalid");
      return voiceErrorResponse("This lead does not have a valid phone number.");
    }

    const authorLabel = user.name?.trim() || user.email;
    // Upsert makes Twilio retries idempotent; the follow-up shape check detects SID collisions.
    const contactCall = await prisma.contactCall.upsert({
      where: { providerCallId: callSid },
      update: {},
      create: {
        provider: "twilio",
        providerCallId: callSid,
        direction: "OUTBOUND",
        status: "INITIATED",
        contactId,
        phoneNumber,
        authorId: user.id,
        authorLabel,
        startedAt: new Date(),
      },
    });
    if (
      contactCall.provider !== "twilio" ||
      contactCall.contactId !== contactId ||
      contactCall.direction !== "OUTBOUND"
    ) {
      throw new Error(
        `CallSid ${callSid} is already attached to a different ContactCall (${contactCall.id})`
      );
    }

    // Managed-secret resolution is same-database work bounded by the webhook request lifetime.
    const callerId = await getTwilioNumber();
    const response = new twilio.twiml.VoiceResponse();
    response.say("This call may be recorded.");
    const dial = response.dial({
      callerId,
      record: "record-from-answer-dual",
      recordingStatusCallback: `${appUrl()}/api/webhooks/twilio/voice/recording`,
      recordingStatusCallbackEvent: ["completed"],
      answerOnBridge: true,
    });
    dial.number(
      {
        statusCallback: `${appUrl()}/api/webhooks/twilio/voice/status?contactCallId=${encodeURIComponent(contactCall.id)}`,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
      },
      phoneNumber
    );
    return voiceTwimlResponse(response);
  } catch (error) {
    logger.error(
      { err: error, callSid, contactId, userId },
      "[twilio outbound voice] failed to build call TwiML"
    );
    return voiceErrorResponse("We cannot connect your call right now. Please try again later.");
  }
}
