import { SMS_OPT_IN_CONFIRMATION, normalizePhoneE164 } from "@/lib/phone";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { getSecret } from "@/lib/secrets";
import { getTwilioNumber, sendSms } from "@/lib/twilio/client";

type ConfirmationContact = {
  id: string;
  phone: string | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
};

type ConfirmationDelivery = {
  contactId: string;
  phone: string;
  body: string;
};

export type SmsOptInConfirmationDeps = {
  isEnabled: () => Promise<boolean> | boolean;
  deliver: (delivery: ConfirmationDelivery) => Promise<"sent" | "duplicate">;
  logError: (error: unknown) => void;
};

const CONFIRMATION_AUTHOR_LABEL = "SMS opt-in confirmation";

/**
 * One confirmation per PHONE NUMBER, ever. The quiz endpoint is public, so
 * "once per contact" would let a script text one number through many emails.
 * ContactMessage.providerSid is unique: the queued row is created under this
 * key, so two racing submissions cannot both claim the same number.
 */
export function optInConfirmationClaimSid(phone: string): string {
  return `optin-confirm:${phone}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function deliverConfirmation(
  delivery: ConfirmationDelivery
): Promise<"sent" | "duplicate"> {
  const alreadyConfirmed = await prisma.contactMessage.findFirst({
    where: { toNumber: delivery.phone, authorLabel: CONFIRMATION_AUTHOR_LABEL },
    select: { id: true },
  });
  if (alreadyConfirmed) return "duplicate";

  const fromNumber = await getTwilioNumber();
  let queuedMessage: { id: string };
  try {
    queuedMessage = await prisma.contactMessage.create({
      data: {
        contactId: delivery.contactId,
        provider: "twilio",
        providerSid: optInConfirmationClaimSid(delivery.phone),
        direction: "OUTBOUND",
        status: "QUEUED",
        body: delivery.body,
        fromNumber,
        toNumber: delivery.phone,
        authorLabel: CONFIRMATION_AUTHOR_LABEL,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }

  try {
    const providerSid = await sendSms({ to: delivery.phone, body: delivery.body });
    await prisma.contactMessage.update({
      where: { id: queuedMessage.id },
      data: { status: "SENT", providerSid },
    });
    return "sent";
  } catch (error) {
    const sendError = error instanceof Error ? error : new Error(String(error));
    try {
      await prisma.contactMessage.update({
        where: { id: queuedMessage.id },
        data: { status: "FAILED", error: sendError.message },
      });
    } catch (updateError) {
      throw new AggregateError(
        [sendError, updateError],
        `SMS opt-in confirmation failed and message ${queuedMessage.id} could not be marked FAILED`
      );
    }
    throw sendError;
  }
}

const DEFAULT_DEPS: SmsOptInConfirmationDeps = {
  // Managed secret first (Settings → Integrations), env as the bootstrap floor.
  isEnabled: async () =>
    (await getSecret("SMS_OPTIN_CONFIRMATION_ENABLED"))?.trim().toLowerCase() === "true",
  deliver: deliverConfirmation,
  logError: (error) => {
    logger.error({ err: error }, "[SMS opt-in] confirmation failed");
  },
};

export async function sendSmsOptInConfirmation(
  input: {
    contact: ConfirmationContact;
    /** This write granted an SMS consent that was not on file for this number. */
    smsConsentGrantedNow: boolean;
  },
  deps: SmsOptInConfirmationDeps = DEFAULT_DEPS
): Promise<"disabled" | "ineligible" | "sent" | "duplicate" | "failed"> {
  // The enablement lookup reads the database; a failure there must never
  // surface into the quiz or settings save, so it counts as "off".
  let enabled = false;
  try {
    enabled = await deps.isEnabled();
  } catch (error) {
    deps.logError(error);
    return "disabled";
  }
  if (!enabled) return "disabled";

  const { contact } = input;
  const normalizedPhone = normalizePhoneE164(contact.phone);
  const hasSmsConsent = Boolean(
    contact.smsMarketingConsentAt || contact.smsTransactionalConsentAt
  );
  if (
    !input.smsConsentGrantedNow ||
    !hasSmsConsent ||
    contact.smsOptOutAt ||
    !normalizedPhone ||
    normalizedPhone !== contact.phone
  ) {
    return "ineligible";
  }

  try {
    return await deps.deliver({
      contactId: contact.id,
      phone: normalizedPhone,
      body: SMS_OPT_IN_CONFIRMATION,
    });
  } catch (error) {
    deps.logError(error);
    return "failed";
  }
}
