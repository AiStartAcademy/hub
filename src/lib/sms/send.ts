import type { ContactMessage } from "@/generated/client";
import { appUrl } from "@/lib/drip/engine";
import {
  normalizePhoneE164,
  smsableReason,
  type SmsabilityReason,
  type SmsPurpose,
} from "@/lib/phone";
import prisma from "@/lib/prisma";
import { renderSmsBody } from "@/lib/sms/render";
import { getTwilioNumber, sendSms } from "@/lib/twilio/client";

export type SendContactSmsInput = {
  contactId: string;
  body: string;
  purpose: SmsPurpose;
  dripSendId?: string;
  authorId?: string;
  authorLabel?: string;
};

export type SendContactSmsResult =
  | { ok: true; message: ContactMessage }
  | { ok: false; reason: SmsabilityReason };

export async function sendContactSms({
  contactId,
  body,
  purpose,
  dripSendId,
  authorId,
  authorLabel,
}: SendContactSmsInput): Promise<SendContactSmsResult> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      phone: true,
      smsMarketingConsentAt: true,
      smsTransactionalConsentAt: true,
      smsOptOutAt: true,
      name: true,
    },
  });
  if (!contact) throw new Error(`Cannot send SMS: contact ${contactId} was not found`);

  const reason = smsableReason(contact, purpose);
  if (reason) return { ok: false, reason };

  const toNumber = normalizePhoneE164(contact.phone);
  if (!toNumber) return { ok: false, reason: "invalid_phone" };

  const fromNumber = await getTwilioNumber();
  const renderedBody = renderSmsBody(body, { name: contact.name });
  const queuedMessage = await prisma.contactMessage.create({
    data: {
      contactId,
      dripSendId: dripSendId ?? null,
      provider: "twilio",
      direction: "OUTBOUND",
      status: "QUEUED",
      body: renderedBody,
      fromNumber,
      toNumber,
      authorId: authorId ?? null,
      authorLabel: authorLabel ?? null,
    },
  });

  try {
    const providerSid = await sendSms({
      to: toNumber,
      body: renderedBody,
      statusCallback: `${appUrl()}/api/webhooks/twilio/sms/status`,
    });
    const message = await prisma.contactMessage.update({
      where: { id: queuedMessage.id },
      data: { status: "SENT", providerSid },
    });
    return { ok: true, message };
  } catch (error) {
    const sendError =
      error instanceof Error
        ? error
        : new Error(`Twilio SMS send failed with a non-Error value: ${String(error)}`);
    try {
      await prisma.contactMessage.update({
        where: { id: queuedMessage.id },
        data: { status: "FAILED", error: sendError.message },
      });
    } catch (updateError) {
      throw new AggregateError(
        [sendError, updateError],
        `SMS send failed for contact ${contactId}, and ContactMessage ${queuedMessage.id} could not be marked FAILED`
      );
    }
    throw sendError;
  }
}
