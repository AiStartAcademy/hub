import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { appUrl } from "@/lib/drip/engine";
import { getSecret } from "@/lib/secrets";
import { CRM_STAFF_ROLES } from "@/lib/adminGuard";
import { hasAnyRole } from "@/lib/roles";
import { normalizePhoneE164 } from "@/lib/phone";
import { createUnknownCaller } from "@/lib/calls/inboundContact";
import {
  buildLegs,
  packLegs,
  parseRingStrategy,
  parseRouteChain,
  twimlForLeg,
  validateRoutingNumbers,
} from "@/lib/calls/inboundRouting";
import { verifiedTwilioParams } from "@/app/api/webhooks/twilio/_shared";
import {
  isCallSid,
  voiceErrorResponse,
  voiceTwimlResponse,
  voicemailTwiml,
} from "@/app/api/webhooks/twilio/voice/_shared";

export const dynamic = "force-dynamic";

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export async function POST(req: Request): Promise<Response> {
  // Verification performs same-database secret reads and request parsing bounded by this request.
  const verified = await verifiedTwilioParams(req, "inbound-voice");
  if (!verified.ok) {
    return verified.response.status >= 500
      ? voiceErrorResponse("We cannot answer your call right now. Please try again later.", 500)
      : verified.response;
  }

  const callSid = verified.params.CallSid?.trim() ?? "";
  const from = verified.params.From?.trim() ?? "";
  const normalizedFrom = normalizePhoneE164(from);
  if (!isCallSid(callSid) || !normalizedFrom) {
    logger.error(
      { callSid, from },
      "[twilio inbound voice] verified request has invalid CallSid or From"
    );
    return voiceErrorResponse("We could not validate your call. Please try again later.");
  }

  try {
    // Contact, availability, and managed-config reads are independent work bounded by this request.
    const [
      existingContact,
      availableUsers,
      rawRouteChain,
      rawRingStrategy,
      rawForwardNumber,
      rawVapiNumber,
      rawTwilioNumber,
    ] = await Promise.all([
      prisma.contact.findFirst({
        where: { phone: normalizedFrom },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: { isAvailableForCalls: true },
        select: { id: true, role: true, roles: true },
      }),
      getSecret("INBOUND_ROUTE_CHAIN"),
      getSecret("CLOSER_RING_STRATEGY"),
      getSecret("INBOUND_FORWARD_NUMBER"),
      getSecret("VAPI_INBOUND_NUMBER"),
      getSecret("TWILIO_PHONE_NUMBER"),
    ]);
    const contact =
      existingContact ??
      (await createUnknownCaller(
        from,
        normalizedFrom,
        callSid,
        "[twilio inbound voice]"
      ));

    const eligibleCloserUsers = availableUsers.filter(
      (user) => USER_ID_PATTERN.test(user.id) && hasAnyRole(user, CRM_STAFF_ROLES)
    );
    const eligibleCloserIds = eligibleCloserUsers.map((user) => user.id);

    // Sticky-owner lookup and one aggregate for all closer recency avoid N+1 queries.
    const latestOwnerCall = await prisma.contactCall.findFirst({
      where: { contactId: contact.id, authorId: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { authorId: true },
    });
    const [ownerUser, closerActivity] = await Promise.all([
      latestOwnerCall?.authorId
        ? prisma.user.findUnique({
            where: { id: latestOwnerCall.authorId },
            select: { id: true, role: true, roles: true, isAvailableForCalls: true },
          })
        : Promise.resolve(null),
      prisma.contactCall.groupBy({
        by: ["authorId"],
        where: { authorId: { in: eligibleCloserIds } },
        _max: { createdAt: true },
      }),
    ]);
    const lastAnsweredAtByUser = new Map(
      closerActivity.flatMap((activity) =>
        activity.authorId ? [[activity.authorId, activity._max.createdAt] as const] : []
      )
    );

    const chain = parseRouteChain(rawRouteChain);
    const strategy = parseRingStrategy(rawRingStrategy);
    const routingNumbers = validateRoutingNumbers({
      forwardNumber: rawForwardNumber,
      vapiNumber: rawVapiNumber,
      twilioNumber: rawTwilioNumber,
    });
    if (routingNumbers.errors.length > 0) {
      logger.error(
        { callSid, errors: routingNumbers.errors },
        "[twilio inbound voice] ignored invalid routing number configuration"
      );
    }

    // Upsert makes repeated inbound webhook deliveries safe on CallSid.
    const contactCall = await prisma.contactCall.upsert({
      where: { providerCallId: callSid },
      update: {},
      create: {
        provider: "twilio",
        providerCallId: callSid,
        direction: "INBOUND",
        status: "INITIATED",
        contactId: contact.id,
        phoneNumber: normalizedFrom,
        startedAt: new Date(),
      },
    });
    if (
      contactCall.provider !== "twilio" ||
      contactCall.contactId !== contact.id ||
      contactCall.direction !== "INBOUND"
    ) {
      throw new Error(
        `CallSid ${callSid} is already attached to a different ContactCall (${contactCall.id})`
      );
    }
    const contactCallId = contactCall.id;

    const legs = buildLegs({
      chain,
      strategy,
      forwardNumber: routingNumbers.forwardNumber,
      vapiNumber: routingNumbers.vapiNumber,
      ownerCandidate: ownerUser
        ? {
            userId: ownerUser.id,
            available: ownerUser.isAvailableForCalls,
            isStaff: hasAnyRole(ownerUser, CRM_STAFF_ROLES),
          }
        : null,
      availableClosers: eligibleCloserUsers.map((user) => ({
        id: user.id,
        lastAnsweredAt: lastAnsweredAtByUser.get(user.id) ?? null,
      })),
    });
    if (legs.length === 0) {
      logger.info({ callSid, contactCallId }, "[twilio inbound voice] routing chain has no legs");
      return voiceTwimlResponse(voicemailTwiml());
    }

    const packedLegs = packLegs(legs);
    logger.info(
      { callSid, contactCallId, legCount: legs.length, firstLegKind: legs[0].kind },
      "[twilio inbound voice] starting routing chain"
    );
    return voiceTwimlResponse(
      twimlForLeg(legs[0], {
        contactCallId,
        contactId: contact.id,
        leadName: contact.name,
        legs: packedLegs,
        index: 0,
        appUrl: appUrl(),
      })
    );
  } catch (error) {
    logger.error(
      { err: error, callSid, callerNumber: normalizedFrom },
      "[twilio inbound voice] failed to build inbound TwiML"
    );
    return voiceErrorResponse("We cannot answer your call right now. Please try again later.");
  }
}
