import { v4 as uuidv4 } from "uuid";
import prisma from "@/lib/prisma";

const ACCOUNT_SETUP_PREFIX = "account-setup:";

/** Default lifetime of a verification/setup token. */
const DEFAULT_TOKEN_TTL_MS = 3600 * 1000; // 1 hour

export const generateVerificationToken = async (
  email: string,
  options: { ttlMs?: number } = {}
) => {
  const token = uuidv4();
  const ttlMs =
    Number.isFinite(options.ttlMs) && (options.ttlMs as number) > 0
      ? (options.ttlMs as number)
      : DEFAULT_TOKEN_TTL_MS;
  const expires = new Date(Date.now() + ttlMs);

  const existingToken = await prisma.verificationToken.findFirst({
    where: { identifier: email },
  });

  if (existingToken) {
    await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: email,
          token: existingToken.token,
        },
      },
    });
  }

  const verificationToken = await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      expires,
    },
  });

  return verificationToken;
};

/**
 * Setup token for a passwordless account. The default hour is right for a
 * checkout confirmation the buyer is reading immediately; free registrations
 * pass a longer ttlMs, because the hub has no password-reset route and an
 * expired link leaves them with only Google sign-in or re-registering.
 */
export const generateAccountSetupToken = (
  email: string,
  options: { ttlMs?: number } = {}
) => generateVerificationToken(`${ACCOUNT_SETUP_PREFIX}${email}`, options);

export const getAccountSetupEmail = (identifier: string): string | null => {
  if (!identifier.startsWith(ACCOUNT_SETUP_PREFIX)) return null;
  const email = identifier.slice(ACCOUNT_SETUP_PREFIX.length);
  return email || null;
};
