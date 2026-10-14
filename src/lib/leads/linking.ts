import prisma from "@/lib/prisma";
import { normalizeEmail } from "@/lib/onboarding-security";
import type { Prisma } from "@prisma/client";

export type AutoLinkSource = "auto_email" | "auto_phone";

export type AutoLinkCandidate = {
  userId: string;
  source: AutoLinkSource;
};

type UserMatch = {
  id: string;
  email: string;
  birthday: string | null;
};

/**
 * Exact match on the normalized address, against the unique `User.email` index —
 * the same lookup `findUserIdForContact` has always used. Both sides are
 * lowercased and trimmed by `normalizeEmail` before they are compared.
 */
async function findUserByEmail(email: string): Promise<UserMatch | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  return prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, birthday: true },
  });
}

/** Returns the automatic match without changing either record. */
export async function findAutoLinkCandidateForContact(
  contactId: string
): Promise<AutoLinkCandidate | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, email: true, linkSource: true },
  });
  if (!contact) throw new Error(`Cannot auto-link missing contact ${contactId}`);
  if (contact.linkSource === "manual") return null;

  const emailMatch = await findUserByEmail(contact.email);
  if (emailMatch) return { userId: emailMatch.id, source: "auto_email" };

  // User has no phone column, so an E.164 comparison has no user-side value to
  // normalize. Keep the source union future-ready without inventing storage.
  return null;
}

function nonEmptyString(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value : null;
}

/**
 * Fills only empty linked fields, preserving first-touch attribution and never
 * promoting the Contact's synthetic "Lead" name onto a User.
 */
async function syncLinkedFields(
  tx: Prisma.TransactionClient,
  contact: {
    id: string;
    birthday: string | null;
    name: string;
    attribution: string | null;
  },
  user: {
    id: string;
    birthday: string | null;
    name: string | null;
    attribution: string | null;
  }
): Promise<void> {
  const userData: {
    birthday?: string;
    name?: string;
    attribution?: string;
  } = {};
  const contactData: {
    birthday?: string;
    name?: string;
    attribution?: string;
  } = {};

  if (contact.birthday && !user.birthday) {
    userData.birthday = contact.birthday;
  } else if (user.birthday && !contact.birthday) {
    contactData.birthday = user.birthday;
  }

  const contactName = contact.name === "Lead" ? null : nonEmptyString(contact.name);
  const userName = nonEmptyString(user.name);
  if (contactName && !userName) {
    userData.name = contactName;
  } else if (!contactName && userName) {
    contactData.name = userName;
  }

  const contactAttribution = nonEmptyString(contact.attribution);
  const userAttribution = nonEmptyString(user.attribution);
  if (contactAttribution && !userAttribution) {
    userData.attribution = contactAttribution;
  } else if (!contactAttribution && userAttribution) {
    contactData.attribution = userAttribution;
  }

  if (Object.keys(userData).length > 0) {
    await tx.user.update({
      where: { id: user.id },
      data: userData,
    });
  }
  if (Object.keys(contactData).length > 0) {
    await tx.contact.update({
      where: { id: contact.id },
      data: contactData,
    });
  }
  // For each field, when both sides are empty or populated, preserving both values
  // is intentional; differing populated values retain their existing first touch.
}

async function establishLink(
  contactId: string,
  userId: string,
  source: AutoLinkSource | "manual"
): Promise<void> {
  // No explicit timeout: this local transaction must complete atomically within
  // the enclosing request, webhook, or one-time script lifecycle.
  await prisma.$transaction(async (tx) => {
    const [contact, user] = await Promise.all([
      tx.contact.findUnique({
        where: { id: contactId },
        select: {
          id: true,
          userId: true,
          linkSource: true,
          birthday: true,
          name: true,
          attribution: true,
        },
      }),
      tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          birthday: true,
          name: true,
          attribution: true,
        },
      }),
    ]);
    if (!contact) throw new Error(`Cannot link missing contact ${contactId}`);
    if (!user) throw new Error(`Cannot link contact ${contactId} to missing user ${userId}`);

    if (source !== "manual" && contact.linkSource === "manual") return;
    if (
      source !== "manual" &&
      contact.userId === userId &&
      contact.linkSource === source
    ) {
      return;
    }

    await tx.contact.update({
      where: { id: contactId },
      data: { userId, linkSource: source },
    });
    await syncLinkedFields(tx, contact, user);
  });
}

/** Automatically links by normalized email; manual links are immutable here. */
export async function autoLinkContact(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, userId: true, linkSource: true },
  });
  if (!contact) throw new Error(`Cannot auto-link missing contact ${contactId}`);
  if (contact.linkSource === "manual") return;

  const candidate = await findAutoLinkCandidateForContact(contactId);
  if (!candidate) return;
  if (contact.userId === candidate.userId && contact.linkSource === candidate.source) return;

  await establishLink(contactId, candidate.userId, candidate.source);
}

/** Manually links two existing records and protects the result from auto-linking. */
export async function linkContactToUser(contactId: string, userId: string): Promise<void> {
  await establishLink(contactId, userId, "manual");
}

/** Clears both manual and automatic link metadata after validating the contact. */
export async function unlinkContact(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true },
  });
  if (!contact) throw new Error(`Cannot unlink missing contact ${contactId}`);

  await prisma.contact.update({
    where: { id: contactId },
    data: { userId: null, linkSource: null },
  });
}

/** Finds and auto-links one unlinked contact after a user is created. */
export async function autoLinkContactForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`Cannot reverse auto-link missing user ${userId}`);

  const normalizedEmail = normalizeEmail(user.email);
  if (!normalizedEmail) return null;

  // Exact match on the unique `Contact.email` index, mirroring the forward
  // direction in findUserByEmail.
  const contact = await prisma.contact.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, userId: true, linkSource: true },
  });
  if (!contact) return null;
  if (contact.userId || contact.linkSource === "manual") return null;

  await autoLinkContact(contact.id);
  return contact.id;
}
