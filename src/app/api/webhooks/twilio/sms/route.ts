import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { normalizePhoneE164 } from "@/lib/phone";
import {
  twimlResponse,
  verifiedTwilioParams,
} from "@/app/api/webhooks/twilio/_shared";
import { smsKeywordAction, smsOptOutWrite } from "@/lib/sms/keywords";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const verified = await verifiedTwilioParams(req, "inbound-sms");
  if (!verified.ok) return verified.response;

  const from = verified.params.From ?? "";
  const to = verified.params.To ?? "";
  const body = verified.params.Body ?? "";
  const messageSid = verified.params.MessageSid?.trim() ?? "";
  const normalizedFrom = normalizePhoneE164(from);

  if (!messageSid) {
    logger.error(
      { from, normalizedFrom },
      "[twilio inbound sms] verified request is missing MessageSid"
    );
    return twimlResponse(400);
  }
  if (!to.trim()) {
    logger.error(
      { messageSid, from, normalizedFrom },
      "[twilio inbound sms] verified request is missing To"
    );
    return twimlResponse(400);
  }
  if (!normalizedFrom) {
    logger.warn(
      { messageSid, from, normalizedFrom: null },
      "[twilio inbound sms] unknown or invalid sender number"
    );
    return twimlResponse();
  }

  try {
    const contact = await prisma.contact.findFirst({
      where: { phone: normalizedFrom },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!contact) {
      logger.warn(
        { messageSid, normalizedFrom },
        "[twilio inbound sms] unknown sender number"
      );
      return twimlResponse();
    }

    const keywordAction = smsKeywordAction(body);
    const now = new Date();
    const normalizedTo = normalizePhoneE164(to) ?? to.trim();

    await prisma.$transaction(async (tx) => {
      const message = await tx.contactMessage.upsert({
        where: { providerSid: messageSid },
        update: {},
        create: {
          contactId: contact.id,
          provider: "twilio",
          providerSid: messageSid,
          direction: "INBOUND",
          status: "RECEIVED",
          body,
          fromNumber: normalizedFrom,
          toNumber: normalizedTo,
        },
        select: { contactId: true },
      });
      if (message.contactId !== contact.id) {
        throw new Error(
          `Twilio MessageSid ${messageSid} is already attached to contact ${message.contactId}, not ${contact.id}`
        );
      }

      await tx.contact.update({
        where: { id: contact.id },
        data: { lastActivityAt: now },
      });
      const optOutWrite = smsOptOutWrite(keywordAction, now);
      if (optOutWrite) {
        // Every contact that holds this number, not only the most recent one.
        await tx.contact.updateMany({
          where: { phone: normalizedFrom },
          data: optOutWrite,
        });
      }
    });

    logger.info(
      { messageSid, contactId: contact.id, normalizedFrom },
      "[twilio inbound sms] message recorded"
    );
    return twimlResponse();
  } catch (error) {
    logger.error(
      { err: error, messageSid, normalizedFrom },
      "[twilio inbound sms] failed to process verified request"
    );
    return twimlResponse(500);
  }
}
