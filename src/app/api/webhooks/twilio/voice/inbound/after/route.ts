import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { appUrl } from "@/lib/drip/engine";
import { getTwilioClient } from "@/lib/twilio/client";
import {
  nextLeg,
  twimlForLeg,
  unpackLegs,
  type Leg,
} from "@/lib/calls/inboundRouting";
import { verifiedTwilioParams } from "@/app/api/webhooks/twilio/_shared";
import {
  CLOSER_IDENTITY_PATTERN,
  findContactCallForWebhook,
  isCallSid,
  isContactCallId,
  isTerminalCallStatus,
  voiceErrorResponse,
  voiceTwimlResponse,
  voicemailTwiml,
} from "@/app/api/webhooks/twilio/voice/_shared";
import twilio from "twilio";

export const dynamic = "force-dynamic";

const DIAL_STATUSES = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

function parseLegIndex(value: string | null, legCount: number): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) && index < legCount ? index : null;
}

function closerIdFromIdentity(value: string): string | null {
  return CLOSER_IDENTITY_PATTERN.exec(value.trim())?.[1] ?? null;
}

function callbackCloserIdentity(
  params: Record<string, string>
): { parameter: string; userId: string } | null {
  for (const [parameter, value] of Object.entries(params)) {
    const userId = closerIdFromIdentity(value);
    if (userId) return { parameter, userId };
  }
  return null;
}

function fetchedCallTo(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("to" in value)) return null;
  return typeof value.to === "string" ? value.to.trim() : null;
}

async function resolveAnsweringCloserId(
  params: Record<string, string>,
  callSid: string
): Promise<string | null> {
  const callbackIdentity = callbackCloserIdentity(params);
  if (callbackIdentity) {
    logger.info(
      { callSid, identityParameter: callbackIdentity.parameter },
      "[twilio inbound after] resolved closer identity from callback"
    );
    return callbackIdentity.userId;
  }

  const dialCallSid = params.DialCallSid?.trim() ?? "";
  if (!dialCallSid) {
    logger.warn(
      { callSid, reason: "DialCallSid is absent and no callback parameter contains a closer identity" },
      "[twilio inbound after] could not resolve answering closer"
    );
    return null;
  }
  if (!isCallSid(dialCallSid)) {
    logger.warn(
      { callSid, dialCallSid, reason: "DialCallSid has an invalid shape" },
      "[twilio inbound after] could not resolve answering closer"
    );
    return null;
  }

  try {
    const twilioClient = await getTwilioClient();
    const fetchedCall: unknown = await twilioClient.calls(dialCallSid).fetch();
    const dialedTo = fetchedCallTo(fetchedCall);
    if (!dialedTo) {
      logger.warn(
        { callSid, dialCallSid, reason: "Twilio call response has no string to field" },
        "[twilio inbound after] could not resolve answering closer"
      );
      return null;
    }
    const userId = closerIdFromIdentity(dialedTo);
    if (!userId) {
      logger.warn(
        { callSid, dialCallSid, reason: "Twilio call to field is not a closer client identity" },
        "[twilio inbound after] could not resolve answering closer"
      );
      return null;
    }
    return userId;
  } catch (error) {
    logger.error(
      { err: error, callSid, dialCallSid, reason: "Twilio child-call fetch failed" },
      "[twilio inbound after] could not resolve answering closer"
    );
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  // Verification performs same-database secret reads and request parsing bounded by this request.
  const verified = await verifiedTwilioParams(req, "inbound-voice-after-dial");
  if (!verified.ok) {
    return verified.response.status >= 500
      ? voiceErrorResponse("We cannot complete your call right now. Please try again later.", 500)
      : verified.response;
  }

  const url = new URL(req.url);
  const contactCallId = url.searchParams.get("contactCallId")?.trim() ?? "";
  const packedLegs = url.searchParams.get("legs");
  const legs = unpackLegs(packedLegs);
  const legIndex = parseLegIndex(url.searchParams.get("i"), legs?.length ?? 0);
  const callSid = verified.params.CallSid?.trim() ?? "";
  const dialCallStatus = verified.params.DialCallStatus?.trim().toLowerCase() ?? "";
  if (!legs || legIndex === null || packedLegs === null) {
    logger.error(
      {
        callSid,
        contactCallId,
        packedLegsLength: packedLegs?.length ?? null,
        rawLegIndex: url.searchParams.get("i"),
        unpackedLegCount: legs?.length ?? null,
      },
      "[twilio inbound after] verified request has invalid routing chain parameters"
    );
    return voiceTwimlResponse(voicemailTwiml());
  }
  if (
    !isCallSid(callSid) ||
    (contactCallId && !isContactCallId(contactCallId)) ||
    !DIAL_STATUSES.has(dialCallStatus)
  ) {
    logger.error(
      { callSid, contactCallId, dialCallStatus },
      "[twilio inbound after] verified request has invalid parameters"
    );
    return voiceErrorResponse("We could not complete your call. Please try again later.");
  }

  try {
    const advancement = nextLeg(legs, legIndex, dialCallStatus);
    // Correlation is a bounded same-database read used for trusted routing metadata and outcomes.
    const contactCall = await findContactCallForWebhook({ contactCallId, callSid });
    if (advancement.action === "dial") {
      if (!contactCall) {
        logger.error(
          { callSid, contactCallId, dialCallStatus, nextLegIndex: advancement.index },
          "[twilio inbound after] cannot advance routing chain without persisted call"
        );
        return voiceTwimlResponse(voicemailTwiml());
      }
      const contact = await prisma.contact.findUnique({
        where: { id: contactCall.contactId },
        select: { id: true, name: true },
      });
      if (!contact) {
        logger.error(
          { callSid, contactCallId: contactCall.id, contactId: contactCall.contactId },
          "[twilio inbound after] cannot advance routing chain without persisted contact"
        );
        return voiceTwimlResponse(voicemailTwiml());
      }
      logger.info(
        { callSid, contactCallId, previousLegIndex: legIndex, nextLegIndex: advancement.index },
        "[twilio inbound after] advancing routing chain"
      );
      return voiceTwimlResponse(
        twimlForLeg(advancement.leg, {
          contactCallId: contactCall.id,
          contactId: contact.id,
          leadName: contact.name,
          legs: packedLegs,
          index: advancement.index,
          appUrl: appUrl(),
        })
      );
    }

    if (contactCall) {
      const completedLeg: Leg = legs[legIndex];
      const isNumberTransfer =
        advancement.action === "finalize" && completedLeg.kind === "number";
      const nextStatus =
        advancement.action === "finalize"
          ? isNumberTransfer
            ? "TRANSFERRED"
            : "COMPLETED"
          : "NO_ANSWER";
      let author: { authorId: string; authorLabel: string } | null = null;
      if (advancement.action === "finalize" && completedLeg.kind === "closer") {
        const userId = await resolveAnsweringCloserId(verified.params, callSid);
        if (userId) {
          try {
            const user = await prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, name: true, email: true },
            });
            if (user) {
              author = {
                authorId: user.id,
                authorLabel: user.name?.trim() || user.email,
              };
            } else {
              logger.warn(
                { callSid, contactCallId: contactCall.id, userId },
                "[twilio inbound after] answering closer user was not found"
              );
            }
          } catch (error) {
            logger.error(
              { err: error, callSid, contactCallId: contactCall.id, userId },
              "[twilio inbound after] failed to load answering closer"
            );
          }
        }
        // No resolved, existing user intentionally leaves the call's author fields untouched.
      } else {
        // Number legs never receive closer attribution; voicemail has no answering party.
      }
      if (!isTerminalCallStatus(contactCall.status) || contactCall.status === nextStatus) {
        // Prisma status persistence is bounded by the webhook request lifetime.
        await prisma.contactCall.updateMany({
          where: {
            id: contactCall.id,
            OR: [
              { status: { notIn: ["COMPLETED", "NO_ANSWER", "VOICEMAIL", "FAILED", "TRANSFERRED"] } },
              { status: nextStatus },
            ],
          },
          data: {
            status: nextStatus,
            ...(advancement.action === "finalize" ? { endedAt: new Date() } : {}),
            ...(isNumberTransfer && completedLeg.kind === "number"
              ? {
                  transferredTo: completedLeg.target,
                  ...(completedLeg.purpose === "vapi" ? { outcome: "ai_handoff" } : {}),
                }
              : {}),
            ...(author ?? {}),
          },
        });
      } else {
        // A different terminal result intentionally wins over this later dial callback.
      }
    } else {
      logger.warn(
        { callSid, contactCallId, dialCallStatus, advancement: advancement.action },
        "[twilio inbound after] no persisted call matched"
      );
    }

    if (advancement.action === "finalize") {
      return voiceTwimlResponse(new twilio.twiml.VoiceResponse());
    }
    // The only remaining exhaustive action is voicemail after the last dial leg.
    return voiceTwimlResponse(voicemailTwiml());
  } catch (error) {
    logger.error(
      { err: error, callSid, contactCallId, dialCallStatus },
      "[twilio inbound after] failed to process dial result"
    );
    return voiceErrorResponse("We cannot complete your call right now. Please try again later.");
  }
}
