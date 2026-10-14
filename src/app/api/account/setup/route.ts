import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { isPasswordValid } from "@/lib/password";
import { getAccountSetupEmail } from "@/lib/tokens";
import { logger } from "@/lib/logger";
import { normalizePhoneE164 } from "@/lib/phone";
import {
  InvalidPhoneError,
  setPersonPhone,
} from "@/lib/leads/personRecord";

const INVALID_LINK_ERROR = "This setup link is invalid or has expired.";
const INVALID_SMS_PHONE_ERROR =
  "Enter a valid mobile number to get class reminders by text.";

class InvalidAccountSetupLinkError extends Error {}

class InvalidAccountSetupSmsPhoneError extends Error {}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const phone = typeof body.phone === "string" ? body.phone : "";
    const smsTransactionalConsent = body.smsTransactionalConsent === true;

    if (!token || !isPasswordValid(password)) {
      return NextResponse.json(
        { error: "Invalid setup link or password." },
        { status: 400 }
      );
    }

    const normalizedPhone = smsTransactionalConsent
      ? normalizePhoneE164(phone)
      : null;
    const hashedPassword = await bcrypt.hash(password, 10);

    const deferredConfirmation = await prisma.$transaction(async (tx) => {
      const setupToken = await tx.verificationToken.findUnique({
        where: { token },
      });
      if (!setupToken || setupToken.expires < new Date()) {
        throw new InvalidAccountSetupLinkError();
      }

      const email = getAccountSetupEmail(setupToken.identifier);
      if (!email) throw new InvalidAccountSetupLinkError();

      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) throw new InvalidAccountSetupLinkError();

      // The link error wins for an invalid token, but phone validation still
      // happens before any password, token, or Contact write.
      if (smsTransactionalConsent && !normalizedPhone) {
        throw new InvalidAccountSetupSmsPhoneError();
      }

      await tx.user.update({
        where: { id: user.id },
        data: { password: hashedPassword, emailVerified: new Date() },
      });
      await tx.verificationToken.delete({ where: { token } });

      if (!smsTransactionalConsent) return undefined;

      const phoneWrite = await setPersonPhone(
        {
          userId: user.id,
          phone: normalizedPhone,
          smsTransactionalConsent: true,
          smsMarketingConsent: false,
          callConsent: false,
          actor: "self",
        },
        {
          db: tx,
          source: "account-setup",
          deferOptInConfirmation: true,
          preserveSmsMarketingAndCallConsent: true,
        }
      );
      return phoneWrite.confirmOptIn;
    });

    deferredConfirmation?.();

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof InvalidAccountSetupLinkError) {
      return NextResponse.json({ error: INVALID_LINK_ERROR }, { status: 400 });
    }
    if (
      error instanceof InvalidAccountSetupSmsPhoneError ||
      error instanceof InvalidPhoneError
    ) {
      return NextResponse.json({ error: INVALID_SMS_PHONE_ERROR }, { status: 400 });
    }

    logger.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Account setup error"
    );
    return NextResponse.json(
      { error: "Could not set up the account." },
      { status: 500 }
    );
  }
}
