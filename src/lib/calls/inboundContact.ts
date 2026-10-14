import type { ContactCall } from "@/generated/client";
import { logger } from "@/lib/logger";
import { normalizePhoneE164 } from "@/lib/phone";
import prisma from "@/lib/prisma";

export type InboundContact = { id: string; name: string };

export type InboundVapiCallPlan =
  | {
      action: "create";
      providerCallId: string;
      rawPhone: string;
      phone: string;
    }
  | {
      action: "skip";
      reason: "invalid-call" | "not-inbound" | "invalid-phone";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownCallerEmail(phone: string): string {
  return `inbound-call-${phone.replace(/^\+/, "")}@unknown.invalid`;
}

function callLogContext(
  providerCallId: string,
  logPrefix: string
): { callSid: string } | { providerCallId: string } {
  return logPrefix === "[twilio inbound voice]" ? { callSid: providerCallId } : { providerCallId };
}

async function findContactByPhone(normalizedPhone: string): Promise<InboundContact | null> {
  return prisma.contact.findFirst({
    where: { phone: normalizedPhone },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
}

export async function createUnknownCaller(
  rawPhone: string,
  normalizedPhone: string,
  providerCallId: string,
  logPrefix: string
): Promise<InboundContact> {
  const email = unknownCallerEmail(normalizedPhone);
  const callContext = callLogContext(providerCallId, logPrefix);
  try {
    const contact = await prisma.contact.create({
      data: {
        email,
        name: `Unknown caller ${rawPhone}`,
        phone: normalizedPhone,
        status: "NEW",
        source: "inbound-call",
        unsubscribedAt: null,
        phoneConsentAt: null,
        doNotCall: false,
        smsOptOutAt: null,
      },
      select: { id: true, name: true },
    });
    logger.info(
      { ...callContext, contactId: contact.id, callerNumber: normalizedPhone },
      `${logPrefix} created contact for unknown caller`
    );
    return contact;
  } catch (error) {
    // Phone is not unique, so the deterministic unique email serializes concurrent creates.
    // Re-querying by phone recovers the loser of that race without granting any consent.
    logger.warn(
      { err: error, ...callContext, callerNumber: normalizedPhone },
      `${logPrefix} unknown-caller create failed; checking for a concurrent create`
    );
    const racedContact = await findContactByPhone(normalizedPhone);
    if (racedContact) return racedContact;
    throw error;
  }
}

export async function findOrCreateContactByPhone(
  rawPhone: string,
  normalizedPhone: string,
  providerCallId: string,
  logPrefix: string
): Promise<InboundContact> {
  const existingContact = await findContactByPhone(normalizedPhone);
  return existingContact ?? createUnknownCaller(rawPhone, normalizedPhone, providerCallId, logPrefix);
}

export function inboundVapiCallPlan(payload: unknown): InboundVapiCallPlan {
  if (!isRecord(payload) || !isRecord(payload.call)) {
    return { action: "skip", reason: "invalid-call" };
  }

  const providerCallId = payload.call.id;
  if (typeof providerCallId !== "string" || providerCallId.trim() === "") {
    return { action: "skip", reason: "invalid-call" };
  }
  if (payload.call.type !== "inboundPhoneCall") {
    return { action: "skip", reason: "not-inbound" };
  }

  const customer = payload.call.customer;
  const rawPhone = isRecord(customer) ? customer.number : undefined;
  if (typeof rawPhone !== "string") {
    return { action: "skip", reason: "invalid-phone" };
  }
  const phone = normalizePhoneE164(rawPhone);
  if (!phone) return { action: "skip", reason: "invalid-phone" };

  return { action: "create", providerCallId, rawPhone, phone };
}

export async function createInboundVapiContactCall(
  plan: Extract<InboundVapiCallPlan, { action: "create" }>
): Promise<ContactCall> {
  const contact = await findOrCreateContactByPhone(
    plan.rawPhone,
    plan.phone,
    plan.providerCallId,
    "[vapi webhook]"
  );

  // Upsert makes repeated inbound Vapi webhook deliveries safe on providerCallId.
  const contactCall = await prisma.contactCall.upsert({
    where: { providerCallId: plan.providerCallId },
    update: {},
    create: {
      provider: "vapi",
      providerCallId: plan.providerCallId,
      direction: "INBOUND",
      status: "INITIATED",
      contactId: contact.id,
      phoneNumber: plan.phone,
      startedAt: new Date(),
    },
  });
  if (
    contactCall.provider !== "vapi" ||
    contactCall.contactId !== contact.id ||
    contactCall.direction !== "INBOUND"
  ) {
    throw new Error(
      `Vapi call ${plan.providerCallId} is already attached to a different ContactCall (${contactCall.id})`
    );
  }
  return contactCall;
}
