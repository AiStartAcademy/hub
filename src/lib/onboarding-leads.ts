import prisma from "@/lib/prisma";
import type { Attribution } from "@/lib/attribution";
import {
  mappedTextAnswer,
  parseFieldMapping,
  resolveFieldMapping,
} from "@/lib/onboarding-fields";
import { normalizeEmail, normalizePhone, sanitizePlainText } from "@/lib/onboarding-security";
import { onboardingPhoneForStorage } from "@/lib/phone";
import {
  EMPTY_PHONE_CONSENT,
  planOnboardingConsentGrant,
  type PhoneConsentChoices,
} from "@/lib/onboarding-phone-consent";
import { autoLinkContact } from "@/lib/leads/linking";
import { logger } from "@/lib/logger";
import { sendSmsOptInConfirmation } from "@/lib/sms/optInConfirmation";

export { onboardingPhoneForStorage };

type LeadForm = {
  slug: string;
  ghlFieldMapping: string | null;
  steps: Array<{
    elements: Array<{ id: string; label: string; type: string }>;
  }>;
};

export async function captureOnboardingLead(input: {
  form: LeadForm;
  responseId: string;
  answers: Record<string, string | string[]>;
  tags: string[];
  attribution: Attribution | null;
  destination: string | null;
  phoneConsent?: PhoneConsentChoices;
  occurredAt?: Date;
}): Promise<
  | { ok: true; contactId: string; email: string; name: string }
  | { ok: false; reason: string }
> {
  const elements = input.form.steps.flatMap((step) => step.elements);
  const mapping = resolveFieldMapping(
    elements,
    parseFieldMapping(input.form.ghlFieldMapping)
  );
  const firstName = mappedTextAnswer(input.answers, mapping.firstName, 100);
  const lastName = mappedTextAnswer(input.answers, mapping.lastName, 100);
  const fullName = mappedTextAnswer(input.answers, mapping.contactName, 200);
  const email = normalizeEmail(mappedTextAnswer(input.answers, mapping.email, 320));
  const rawPhone = normalizePhone(mappedTextAnswer(input.answers, mapping.phone, 50));
  // Prefer strict E.164 (what the voice-call features require); keep the loosely
  // sanitized value when parsing fails so a typo'd number is still visible to staff.
  const phone = onboardingPhoneForStorage(rawPhone);

  if (!email) return { ok: false as const, reason: "No valid mapped email" };

  const name =
    sanitizePlainText([firstName, lastName].filter(Boolean).join(" "), 200) ||
    fullName ||
    "Lead";
  const incomingTags = input.tags
    .map((tag) => sanitizePlainText(tag, 100))
    .filter(Boolean);
  const now = input.occurredAt ?? new Date();

  const existingContact = await prisma.contact.findUnique({
    where: { email },
    select: {
      tags: true,
      phone: true,
      smsMarketingConsentAt: true,
      smsTransactionalConsentAt: true,
      phoneConsentAt: true,
    },
  });
  let existingTags: string[] = [];
  try {
    const parsed = existingContact?.tags ? JSON.parse(existingContact.tags) : [];
    if (Array.isArray(parsed)) {
      existingTags = parsed
        .map((tag) => sanitizePlainText(tag, 100))
        .filter(Boolean);
    }
  } catch {
    existingTags = [];
  }
  const tags = [...new Set([...existingTags, ...incomingTags])];
  const phoneConsent = input.phoneConsent ?? EMPTY_PHONE_CONSENT;
  const existingConsent = {
    smsMarketingConsentAt: existingContact?.smsMarketingConsentAt ?? null,
    smsTransactionalConsentAt: existingContact?.smsTransactionalConsentAt ?? null,
    phoneConsentAt: existingContact?.phoneConsentAt ?? null,
  };
  const existingPhone = existingContact?.phone?.trim() || null;
  const phoneChanged = Boolean(phone && existingPhone && existingPhone !== phone);
  const consentGrant = phone
    ? planOnboardingConsentGrant(existingConsent, phoneConsent, now, { phoneChanged })
    : {};
  // True only when THIS submission ticked an SMS box that was not already on
  // file for this number (a brand-new contact, a first grant, or a new number).
  const smsConsentGrantedNow = existingContact
    ? Boolean(consentGrant.smsMarketingConsentAt || consentGrant.smsTransactionalConsentAt)
    : Boolean(phone && (phoneConsent.smsMarketing || phoneConsent.smsTransactional));

  const contact = await prisma.contact.upsert({
    where: { email },
    update: {
      ...(name !== "Lead" ? { name } : {}),
      ...(phone ? { phone, ...consentGrant } : {}),
      source: `onboarding:${input.form.slug}`,
      tags: JSON.stringify(tags),
      lastActivityAt: now,
    },
    create: {
      email,
      name,
      phone,
      phoneConsentAt: phone && phoneConsent.calls ? now : null,
      smsMarketingConsentAt: phone && phoneConsent.smsMarketing ? now : null,
      smsTransactionalConsentAt:
        phone && phoneConsent.smsTransactional ? now : null,
      status: "NEW",
      source: `onboarding:${input.form.slug}`,
      tags: JSON.stringify(tags),
      attribution: input.attribution ? JSON.stringify(input.attribution) : null,
      lastActivityAt: now,
    },
  });

  // Fire-and-forget: it never throws, and a slow Twilio must not hold up the quiz.
  void sendSmsOptInConfirmation({
    contact: {
      id: contact.id,
      phone: contact.phone,
      smsMarketingConsentAt: contact.smsMarketingConsentAt,
      smsTransactionalConsentAt: contact.smsTransactionalConsentAt,
      smsOptOutAt: contact.smsOptOutAt,
    },
    smsConsentGrantedNow,
  });

  // Linking is best-effort because a CRM match must never fail lead capture.
  void autoLinkContact(contact.id).catch((error: unknown) => {
    logger.error({ err: error, contactId: contact.id }, "[Onboarding lead] Contact auto-link failed");
  });

  const metadata = JSON.stringify({
    formSlug: input.form.slug,
    responseId: input.responseId,
    firstName: firstName || null,
    lastName: lastName || null,
    destination: input.destination,
  });
  const eventData = {
    contactId: contact.id,
    type: "ONBOARDING",
    metadata,
    utmSource: input.attribution?.utm_source ?? null,
    utmMedium: input.attribution?.utm_medium ?? null,
    utmCampaign: input.attribution?.utm_campaign ?? null,
    utmContent: input.attribution?.utm_content ?? null,
  };

  const legacyEvents = await prisma.contactEvent.findMany({
    where: {
      contactId: contact.id,
      type: "ONBOARDING",
      onboardingResponseId: null,
    },
    select: { id: true, metadata: true },
  });
  const legacyEvent = legacyEvents.find((event) => {
    try {
      return JSON.parse(event.metadata)?.responseId === input.responseId;
    } catch {
      return false;
    }
  });
  if (legacyEvent) {
    await prisma.contactEvent.update({
      where: { id: legacyEvent.id },
      data: { ...eventData, onboardingResponseId: input.responseId },
    });
  } else {
    await prisma.contactEvent.upsert({
      where: { onboardingResponseId: input.responseId },
      update: eventData,
      create: { ...eventData, onboardingResponseId: input.responseId },
    });
  }

  return { ok: true as const, contactId: contact.id, email, name };
}
