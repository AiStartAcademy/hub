import twilio from "twilio";
import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import type { ContactCall } from "@/generated/client";
import { appUrl } from "@/lib/drip/engine";

export const TERMINAL_CALL_STATUSES = [
  "COMPLETED",
  "NO_ANSWER",
  "VOICEMAIL",
  "FAILED",
  "TRANSFERRED",
] as const;

const CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;
const CONTACT_CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const CLOSER_IDENTITY_PATTERN = /^client:closer-([A-Za-z0-9_-]{1,128})$/;

export function isCallSid(value: string): boolean {
  return CALL_SID_PATTERN.test(value);
}

export function isContactCallId(value: string): boolean {
  return CONTACT_CALL_ID_PATTERN.test(value);
}

export function voiceTwimlResponse(response: twilio.twiml.VoiceResponse, status = 200): Response {
  return new Response(response.toString(), {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export function voiceErrorResponse(message: string, status = 200): Response {
  const response = new twilio.twiml.VoiceResponse();
  response.say(message);
  response.hangup();
  return voiceTwimlResponse(response, status);
}

export function voicemailTwiml(): twilio.twiml.VoiceResponse {
  const response = new twilio.twiml.VoiceResponse();
  response.say(`Thanks for calling ${brand.wordmark} — leave a message after the tone.`);
  response.record({
    maxLength: 120,
    transcribe: true,
    transcribeCallback: `${appUrl()}/api/webhooks/twilio/voice/transcription`,
    recordingStatusCallback: `${appUrl()}/api/webhooks/twilio/voice/recording`,
    recordingStatusCallbackEvent: ["completed"],
  });
  return response;
}

export async function findContactCallForWebhook(input: {
  contactCallId?: string;
  callSid?: string;
  parentCallSid?: string;
}): Promise<ContactCall | null> {
  if (input.contactCallId && isContactCallId(input.contactCallId)) {
    // Prisma is an in-process database call bounded by the webhook request lifetime.
    const byId = await prisma.contactCall.findUnique({ where: { id: input.contactCallId } });
    if (byId) return byId;
  }
  if (input.callSid && isCallSid(input.callSid)) {
    // Prisma is an in-process database call bounded by the webhook request lifetime.
    const byCallSid = await prisma.contactCall.findUnique({
      where: { providerCallId: input.callSid },
    });
    if (byCallSid) return byCallSid;
  }
  if (input.parentCallSid && isCallSid(input.parentCallSid)) {
    // Prisma is an in-process database call bounded by the webhook request lifetime.
    return prisma.contactCall.findUnique({
      where: { providerCallId: input.parentCallSid },
    });
  }
  return null;
}

export function isTerminalCallStatus(status: string): boolean {
  return (TERMINAL_CALL_STATUSES as readonly string[]).includes(status);
}
