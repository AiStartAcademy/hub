import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  twimlResponse,
  verifiedTwilioParams,
} from "@/app/api/webhooks/twilio/_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const verified = await verifiedTwilioParams(req, "sms-status");
  if (!verified.ok) return verified.response;

  const messageSid = verified.params.MessageSid?.trim() ?? "";
  const messageStatus = verified.params.MessageStatus?.trim().toLowerCase() ?? "";
  const errorCode = verified.params.ErrorCode?.trim() || null;

  if (!messageSid) {
    logger.error({}, "[twilio sms status] verified request is missing MessageSid");
    return twimlResponse(400);
  }
  if (!messageStatus) {
    logger.error({ messageSid }, "[twilio sms status] verified request is missing MessageStatus");
    return twimlResponse(400);
  }

  try {
    const message = await prisma.contactMessage.findUnique({
      where: { providerSid: messageSid },
      select: { id: true, status: true },
    });
    if (!message) {
      logger.warn({ messageSid, messageStatus }, "[twilio sms status] unknown MessageSid");
      return twimlResponse();
    }

    if (messageStatus === "delivered") {
      await prisma.contactMessage.update({
        where: { id: message.id },
        data: { status: "DELIVERED", error: null },
      });
      logger.info({ messageSid }, "[twilio sms status] message delivered");
      return twimlResponse();
    }

    if (messageStatus === "failed" || messageStatus === "undelivered") {
      await prisma.contactMessage.update({
        where: { id: message.id },
        data: { status: "FAILED", error: errorCode },
      });
      logger.warn(
        { messageSid, messageStatus, errorCode },
        "[twilio sms status] message delivery failed"
      );
      return twimlResponse();
    }

    // QUEUED and SENT are persisted by the send path. Intermediate callbacks can
    // arrive out of order, so they must not regress a terminal ledger status.
    if (messageStatus === "queued" || messageStatus === "sending" || messageStatus === "sent") {
      logger.info(
        { messageSid, messageStatus, storedStatus: message.status },
        "[twilio sms status] intermediate status acknowledged without ledger update"
      );
      return twimlResponse();
    }

    logger.warn(
      { messageSid, messageStatus, storedStatus: message.status },
      "[twilio sms status] unsupported status acknowledged"
    );
    return twimlResponse();
  } catch (error) {
    logger.error(
      { err: error, messageSid, messageStatus },
      "[twilio sms status] failed to process verified request"
    );
    return twimlResponse(500);
  }
}
