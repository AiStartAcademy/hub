import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { normalizeDateOnly } from "@/lib/dateOnly";
import {
  createPersonContactForUser,
  InvalidPhoneError,
  PERSON_CONTACT_SELECT,
  resolvePersonContact,
  setPersonPhone,
} from "@/lib/leads/personRecord";
import { smsableReason } from "@/lib/phone";
import {
  communicationPreferencesFromContact,
  type CommunicationPreferences,
  type EmailPreferenceWrite,
  planEmailPreferenceWrite,
} from "@/lib/communicationPreferences";

type ProfileUpdateData = {
  name?: string | null;
  image?: string | null;
  timezone?: string;
  birthday?: string | null;
  bio?: string | null;
};

type PhoneConsentState = {
  phone: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
  smsable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isInvalidPhoneError(error: unknown): boolean {
  return (
    error instanceof InvalidPhoneError ||
    (isRecord(error) && error.code === "INVALID_PHONE")
  );
}

function phoneForWrite(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new InvalidPhoneError();
  return value.trim() === "" ? null : value;
}

function phoneConsentState(
  contact: {
    phone: string | null;
    phoneConsentAt: Date | null;
    smsMarketingConsentAt: Date | null;
    smsTransactionalConsentAt: Date | null;
    smsOptOutAt: Date | null;
    doNotCall: boolean;
  } | null
): PhoneConsentState {
  if (!contact) {
    return {
      phone: null,
      phoneConsentAt: null,
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      smsOptOutAt: null,
      doNotCall: false,
      smsable: false,
    };
  }

  return {
    phone: contact.phone,
    phoneConsentAt: contact.phoneConsentAt,
    smsMarketingConsentAt: contact.smsMarketingConsentAt,
    smsTransactionalConsentAt: contact.smsTransactionalConsentAt,
    smsOptOutAt: contact.smsOptOutAt,
    doNotCall: contact.doNotCall,
    smsable: smsableReason(contact, "any") === null,
  };
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        image: true,
        timezone: true,
        birthday: true,
        bio: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const contact = await resolvePersonContact(session.user.id);

    return NextResponse.json({
      ...user,
      ...phoneConsentState(contact),
      ...communicationPreferencesFromContact(contact),
    });
  } catch (error) {
    logger.error({ err: error }, "Fetch me error:");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsedBody: unknown = await req.json();
    if (!isRecord(parsedBody)) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const body = parsedBody;
    const { name, image, timezone, birthday: birthdayValue, bio } = body;
    const hasPhone = hasOwn(body, "phone");
    const consentKeys = [
      "smsMarketingConsent",
      "smsTransactionalConsent",
      "callConsent",
    ] as const;
    const emailPreferenceKeys = ["marketingEmail", "courseEmail"] as const;
    const hasConsentUpdate = consentKeys.some((key) => hasOwn(body, key));
    const hasEmailPreferenceUpdate = emailPreferenceKeys.some((key) =>
      hasOwn(body, key)
    );

    const invalidConsentKey = consentKeys.find(
      (key) => hasOwn(body, key) && typeof body[key] !== "boolean"
    );
    if (invalidConsentKey) {
      return NextResponse.json(
        { error: "Phone consent choices must be true or false" },
        { status: 400 }
      );
    }

    const invalidEmailPreferenceKey = emailPreferenceKeys.find(
      (key) => hasOwn(body, key) && typeof body[key] !== "boolean"
    );
    if (invalidEmailPreferenceKey) {
      return NextResponse.json(
        { error: "Email preference choices must be true or false" },
        { status: 400 }
      );
    }

    let birthday: string | null | undefined;
    try {
      birthday = birthdayValue === undefined ? undefined : normalizeDateOnly(birthdayValue);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Birthday is invalid" },
        { status: 400 }
      );
    }

    // Build update data only with provided fields
    const data: ProfileUpdateData = {};
    if (name !== undefined) data.name = name as string | null;
    if (image !== undefined) data.image = image as string | null;
    if (timezone !== undefined) data.timezone = timezone as string;
    if (birthday !== undefined) data.birthday = birthday;
    if (bio !== undefined) data.bio = bio as string | null;

    // Don't update if no fields provided
    if (
      Object.keys(data).length === 0 &&
      !hasPhone &&
      !hasConsentUpdate &&
      !hasEmailPreferenceUpdate
    ) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    let currentContact: Awaited<ReturnType<typeof resolvePersonContact>> | undefined;
    const getCurrentContact = async () => {
      if (currentContact === undefined) {
        currentContact = await resolvePersonContact(session.user.id);
      }
      return currentContact;
    };

    let writtenEmailPreferences: CommunicationPreferences | null = null;
    if (hasEmailPreferenceUpdate) {
      const contact = await getCurrentContact();
      const emailWrite: EmailPreferenceWrite = {};

      for (const key of emailPreferenceKeys) {
        if (!hasOwn(body, key)) continue;
        const enabled = body[key] as boolean;
        // Enabling is already the default when no Contact exists, so it must
        // not provision a record merely to write an explicit null.
        if (!contact && enabled) continue;
        const currentOptOutAt =
          key === "marketingEmail"
            ? contact?.unsubscribedAt ?? null
            : contact?.courseEmailOptOutAt ?? null;
        Object.assign(
          emailWrite,
          planEmailPreferenceWrite(key, enabled, new Date(), currentOptOutAt)
        );
      }

      if (Object.keys(emailWrite).length > 0) {
        currentContact = contact
          ? await prisma.contact.update({
              where: { id: contact.id },
              data: emailWrite,
              select: PERSON_CONTACT_SELECT,
            })
          : await createPersonContactForUser({
              userId: session.user.id,
              source: "settings",
              data: emailWrite,
            });
      }

      writtenEmailPreferences = communicationPreferencesFromContact(
        currentContact ?? null
      );
    }

    let writtenPhoneState: PhoneConsentState | null = null;
    if (hasPhone || hasConsentUpdate) {
      // A full phone+consent payload needs nothing from the stored record.
      const previous =
        hasPhone && consentKeys.every((key) => hasOwn(body, key))
          ? null
          : await getCurrentContact();
      const phone = hasPhone
        ? phoneForWrite(body.phone)
        : previous?.phone ?? null;
      const grantsSmsWithoutPhone =
        phone === null &&
        ((hasOwn(body, "smsMarketingConsent") && body.smsMarketingConsent === true) ||
          (hasOwn(body, "smsTransactionalConsent") &&
            body.smsTransactionalConsent === true));
      if (grantsSmsWithoutPhone) {
        return NextResponse.json(
          { error: "Add a mobile number before turning on texts." },
          { status: 400 }
        );
      }
      const smsMarketingConsent = hasOwn(body, "smsMarketingConsent")
        ? (body.smsMarketingConsent as boolean)
        : previous?.smsMarketingConsentAt != null;
      const smsTransactionalConsent = hasOwn(body, "smsTransactionalConsent")
        ? (body.smsTransactionalConsent as boolean)
        : previous?.smsTransactionalConsentAt != null;
      const callConsent = hasOwn(body, "callConsent")
        ? (body.callConsent as boolean)
        : previous?.phoneConsentAt != null;

      const updatedPhone = await setPersonPhone({
        userId: session.user.id,
        phone,
        smsMarketingConsent,
        smsTransactionalConsent,
        callConsent,
        actor: "self",
      });
      writtenPhoneState = phoneConsentState(updatedPhone);
    }

    let updatedUser: Record<string, unknown> = {};
    if (Object.keys(data).length > 0) {
      logger.info({ data }, "Updating user with data:");

      updatedUser = await prisma.user.update({
        where: { id: session.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          timezone: true,
          birthday: true,
          bio: true,
        },
        data,
      });
    }

    return NextResponse.json({
      ...updatedUser,
      ...(writtenPhoneState ?? {}),
      ...(writtenEmailPreferences ?? {}),
    });
  } catch (error) {
    if (isInvalidPhoneError(error)) {
      return NextResponse.json(
        { error: "Enter a valid phone number." },
        { status: 400 }
      );
    }

    logger.error({ err: error }, "Update user error:");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error({ err: error }, "Full error details:");
    return NextResponse.json({ error: `Failed to update profile: ${errorMessage}` }, { status: 500 });
  }
}
