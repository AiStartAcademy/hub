import { autoLinkContact } from "@/lib/leads/linking";
import type { Prisma } from "@/generated/client";
import { logger } from "@/lib/logger";
import { normalizeEmail } from "@/lib/onboarding-security";
import {
  fillPhoneIfEmpty,
  normalizePhoneE164,
  onboardingPhoneForStorage,
  smsableReason,
} from "@/lib/phone";
import prisma from "@/lib/prisma";
import { sendSmsOptInConfirmation } from "@/lib/sms/optInConfirmation";

export type PersonContact = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  birthday: string | null;
  unsubscribedAt?: Date | null;
  courseEmailOptOutAt?: Date | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
  userId: string | null;
  linkSource: string | null;
};

export const PERSON_CONTACT_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  birthday: true,
  unsubscribedAt: true,
  courseEmailOptOutAt: true,
  phoneConsentAt: true,
  smsMarketingConsentAt: true,
  smsTransactionalConsentAt: true,
  smsOptOutAt: true,
  doNotCall: true,
  userId: true,
  linkSource: true,
} as const;

/**
 * Payment states that prove the person became a customer. A refund does not
 * un-make the transaction, and returning that customer to the unworked NEW
 * pipeline would mislabel them. Stripe mutates the same paid row to refunded,
 * so paid-only would silently flip a customer back to NEW. Pending and failed
 * are excluded because neither proves that money moved.
 */
const CUSTOMER_PAYMENT_STATUSES = ["paid", "refunded"] as const;

export type PersonRecordDb = Prisma.TransactionClient | typeof prisma;

export class InvalidPhoneError extends Error {
  readonly code = "INVALID_PHONE";

  constructor() {
    super("Enter a valid phone number.");
    this.name = "InvalidPhoneError";
  }
}

/** Read-only, never creates. */
export async function resolvePersonContact(
  userId: string,
  options: { db?: PersonRecordDb } = {}
): Promise<PersonContact | null> {
  const db = options.db ?? prisma;
  const linkedContact = await db.contact.findFirst({
    where: { userId },
    select: PERSON_CONTACT_SELECT,
  });
  if (linkedContact) return linkedContact;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) return null;

  const email = normalizeEmail(user.email);
  if (!email) return null;

  const emailContact = await db.contact.findUnique({
    where: { email },
    select: PERSON_CONTACT_SELECT,
  });
  if (!emailContact) return null;

  // A fire-and-forget global write cannot safely outlive an interactive
  // transaction. Transactional callers leave linking to their atomic write.
  if (db === prisma) {
    void autoLinkContact(emailContact.id).catch((error: unknown) => {
      logger.error(
        { err: error, contactId: emailContact.id },
        "[Person contact] Contact auto-link failed"
      );
    });
  }

  return emailContact;
}

type SetPersonPhoneInput = {
  userId: string;
  phone: string | null;
  smsMarketingConsent: boolean;
  smsTransactionalConsent: boolean;
  callConsent: boolean;
  actor: "self" | "admin";
  now?: Date;
};

type SetPersonPhoneResult = {
  contactId: string;
  phone: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
  confirmOptIn?: () => void;
};

export type SetPersonPhoneOptions = {
  db?: PersonRecordDb;
  source?: string;
  deferOptInConfirmation?: boolean;
  /**
   * Preserve marketing-SMS and call consent only when the normalized phone is
   * unchanged. A different number still clears old-number consent evidence.
   */
  preserveSmsMarketingAndCallConsent?: boolean;
};

type ConsentAction = "granted" | "withdrawn";

function normalizedPhoneForWrite(phone: string | null): string | null {
  if (phone === null || phone.trim() === "") return null;

  const normalized = normalizePhoneE164(phone);
  if (!normalized) throw new InvalidPhoneError();
  return normalized;
}

function consentAction(
  previous: Date | null,
  next: Date | null
): ConsentAction | null {
  if (previous === null && next !== null) return "granted";
  if (previous !== null && next === null) return "withdrawn";
  return null;
}

async function recordConsentTransition(input: {
  db: PersonRecordDb;
  contactId: string;
  action: ConsentAction | null;
  kind: "sms_marketing" | "sms_transactional" | "calls";
  actor: "self" | "admin";
  actorUserId: string;
  source: string;
}): Promise<void> {
  if (!input.action) return;

  await input.db.contactEvent.create({
    data: {
      contactId: input.contactId,
      type: "PHONE_CONSENT",
      metadata: JSON.stringify({
        action: input.action,
        kind: input.kind,
        source: input.source,
        actorUserId: input.actorUserId,
      }),
    },
  });
}

function asResult(contact: PersonContact): SetPersonPhoneResult {
  return {
    contactId: contact.id,
    phone: contact.phone,
    phoneConsentAt: contact.phoneConsentAt,
    smsMarketingConsentAt: contact.smsMarketingConsentAt,
    smsTransactionalConsentAt: contact.smsTransactionalConsentAt,
    smsOptOutAt: contact.smsOptOutAt,
    doNotCall: contact.doNotCall,
  };
}

type PersonConsentTimestamps = Pick<
  PersonContact,
  "smsMarketingConsentAt" | "smsTransactionalConsentAt" | "phoneConsentAt"
>;

export function planPersonPhoneConsent(input: {
  actor: "self" | "admin";
  phonePresent: boolean;
  /**
   * Consent belongs to the number it was given for. When the stored phone is
   * replaced or cleared, nothing carries over: a person re-consents for the new
   * number with the boxes they tick, and an admin (who can never grant SMS
   * consent) leaves the SMS consents empty.
   */
  phoneChanged?: boolean;
  existing: PersonConsentTimestamps;
  requested: {
    smsMarketing: boolean;
    smsTransactional: boolean;
    calls: boolean;
  };
  now: Date;
}): PersonConsentTimestamps {
  const carried = (previous: Date | null): Date | null =>
    input.phoneChanged ? null : previous;
  const selfManaged = (requested: boolean, previous: Date | null): Date | null =>
    input.phonePresent && requested ? carried(previous) ?? input.now : null;

  return {
    smsMarketingConsentAt:
      input.actor === "self"
        ? selfManaged(input.requested.smsMarketing, input.existing.smsMarketingConsentAt)
        : carried(input.existing.smsMarketingConsentAt),
    smsTransactionalConsentAt:
      input.actor === "self"
        ? selfManaged(
            input.requested.smsTransactional,
            input.existing.smsTransactionalConsentAt
          )
        : carried(input.existing.smsTransactionalConsentAt),
    phoneConsentAt: selfManaged(input.requested.calls, input.existing.phoneConsentAt),
  };
}

/** True when this write granted an SMS consent that was not on file before it. */
export function smsConsentGrantedBetween(
  previous: PersonConsentTimestamps,
  next: PersonConsentTimestamps
): boolean {
  return (
    (next.smsMarketingConsentAt !== null &&
      next.smsMarketingConsentAt !== previous.smsMarketingConsentAt) ||
    (next.smsTransactionalConsentAt !== null &&
      next.smsTransactionalConsentAt !== previous.smsTransactionalConsentAt)
  );
}

async function recordConsentTransitions(input: {
  db: PersonRecordDb;
  contactId: string;
  actor: "self" | "admin";
  actorUserId: string;
  previous: PersonConsentTimestamps;
  next: PersonConsentTimestamps;
  source: string;
}): Promise<void> {
  const transitions = [
    ["sms_marketing", input.previous.smsMarketingConsentAt, input.next.smsMarketingConsentAt],
    [
      "sms_transactional",
      input.previous.smsTransactionalConsentAt,
      input.next.smsTransactionalConsentAt,
    ],
    ["calls", input.previous.phoneConsentAt, input.next.phoneConsentAt],
  ] as const;
  await Promise.all(
    transitions.map(([kind, previous, next]) =>
      recordConsentTransition({
        db: input.db,
        contactId: input.contactId,
        action: consentAction(previous, next),
        kind,
        actor: input.actor,
        actorUserId: input.actorUserId,
        source: input.source,
      })
    )
  );
}

/** Opting in from /settings gets the same one-time confirmation text as the quiz. */
function confirmSmsOptIn(
  contact: PersonContact,
  previous: PersonConsentTimestamps,
  next: PersonConsentTimestamps
): void {
  // Fire-and-forget: it never throws and must not delay the settings save.
  void sendSmsOptInConfirmation({
    contact,
    smsConsentGrantedNow: smsConsentGrantedBetween(previous, next),
  });
}

type CreatePersonContactData = Partial<
  Pick<
    PersonContact,
    | "phone"
    | "phoneConsentAt"
    | "smsMarketingConsentAt"
    | "smsTransactionalConsentAt"
    | "unsubscribedAt"
    | "courseEmailOptOutAt"
  >
>;

/** Shared settings provisioning path for profile and communication writes. */
export async function createPersonContactForUser(
  input: {
    userId: string;
    source: string;
    data?: CreatePersonContactData;
  },
  options: { db?: PersonRecordDb } = {}
): Promise<PersonContact> {
  const db = options.db ?? prisma;
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    throw new Error(`Cannot create settings contact for missing user ${input.userId}`);
  }

  const email = normalizeEmail(user.email);
  if (!email) {
    throw new Error(
      `Cannot create settings contact without an email for user ${input.userId}`
    );
  }

  // Every enrollment status (active, completed, or dropped) means the person actually enrolled.
  const [enrollmentCount, paymentCount] = await Promise.all([
    db.enrollment.count({ where: { userId: input.userId } }),
    db.payment.count({
      where: {
        status: { in: [...CUSTOMER_PAYMENT_STATUSES] },
        // Payment writers normalize buyerEmail, so normalized equality is intentional.
        OR: [{ userId: input.userId }, { buyerEmail: email }],
      },
    }),
  ]);

  return db.contact.create({
    data: {
      email,
      name: user.name && user.name.trim() !== "" ? user.name : "Lead",
      source: input.source,
      tags: JSON.stringify(["account"]),
      userId: input.userId,
      linkSource: "auto_email",
      status: enrollmentCount > 0 || paymentCount > 0 ? "WON" : "NEW",
      ...input.data,
      // smsOptOutAt stays omitted: only inbound STOP/START owns it, and a
      // clear-then-re-add must never launder an existing opt-out.
      // doNotCall stays omitted: it records a human's verbal request, which a
      // web setting must never set or clear. Both use schema defaults here.
    },
    select: PERSON_CONTACT_SELECT,
  });
}

export async function setPersonPhone(
  input: SetPersonPhoneInput,
  options: SetPersonPhoneOptions = {}
): Promise<SetPersonPhoneResult> {
  // Validate first so an invalid number cannot create or update a Contact.
  const phone = normalizedPhoneForWrite(input.phone);
  const now = input.now ?? new Date();
  const db = options.db ?? prisma;
  const source = options.source ?? input.actor;
  const existing = await resolvePersonContact(input.userId, { db });

  const finish = (
    contact: PersonContact,
    previous: PersonConsentTimestamps,
    next: PersonConsentTimestamps
  ): SetPersonPhoneResult => {
    const confirmOptIn = () => confirmSmsOptIn(contact, previous, next);
    if (options.deferOptInConfirmation) {
      return smsConsentGrantedBetween(previous, next)
        ? { ...asResult(contact), confirmOptIn }
        : asResult(contact);
    }
    confirmOptIn();
    return asResult(contact);
  };

  if (!existing) {
    const previousConsent: PersonConsentTimestamps = {
      smsMarketingConsentAt: null,
      smsTransactionalConsentAt: null,
      phoneConsentAt: null,
    };
    const nextConsent = planPersonPhoneConsent({
      actor: input.actor,
      phonePresent: phone !== null,
      existing: previousConsent,
      requested: {
        smsMarketing: input.smsMarketingConsent,
        smsTransactional: input.smsTransactionalConsent,
        calls: input.callConsent,
      },
      now,
    });

    const created = await createPersonContactForUser(
      {
        userId: input.userId,
        source: options.source ?? "settings",
        data: { phone, ...nextConsent },
      },
      { db }
    );

    await recordConsentTransitions({
      db,
      contactId: created.id,
      actor: input.actor,
      actorUserId: input.userId,
      previous: previousConsent,
      next: nextConsent,
      source,
    });
    return finish(created, previousConsent, nextConsent);
  }

  const previousConsent: PersonConsentTimestamps = {
    smsMarketingConsentAt: existing.smsMarketingConsentAt,
    smsTransactionalConsentAt: existing.smsTransactionalConsentAt,
    phoneConsentAt: existing.phoneConsentAt,
  };
  const phoneChanged = (existing.phone?.trim() || null) !== phone;
  const preserveExisting =
    options.preserveSmsMarketingAndCallConsent === true && !phoneChanged;
  const nextConsent = planPersonPhoneConsent({
    actor: input.actor,
    phonePresent: phone !== null,
    phoneChanged,
    existing: previousConsent,
    requested: {
      smsMarketing:
        input.smsMarketingConsent ||
        (preserveExisting && existing.smsMarketingConsentAt !== null),
      smsTransactional: input.smsTransactionalConsent,
      calls:
        input.callConsent ||
        (preserveExisting && existing.phoneConsentAt !== null),
    },
    now,
  });

  // smsOptOutAt stays outside this data type: only inbound STOP/START owns it,
  // and preserving it across clear-then-re-add prevents opt-out laundering.
  // doNotCall stays outside this data type: it records a human's verbal request,
  // which a web checkbox must never set or clear.
  const data: {
    phone?: string | null;
    phoneConsentAt?: Date | null;
    smsMarketingConsentAt?: Date | null;
    smsTransactionalConsentAt?: Date | null;
  } = {};
  if (existing.phone !== phone) data.phone = phone;
  if (existing.phoneConsentAt !== nextConsent.phoneConsentAt) {
    data.phoneConsentAt = nextConsent.phoneConsentAt;
  }
  if (existing.smsMarketingConsentAt !== nextConsent.smsMarketingConsentAt) {
    data.smsMarketingConsentAt = nextConsent.smsMarketingConsentAt;
  }
  if (existing.smsTransactionalConsentAt !== nextConsent.smsTransactionalConsentAt) {
    data.smsTransactionalConsentAt = nextConsent.smsTransactionalConsentAt;
  }

  const contact =
    Object.keys(data).length === 0
      ? existing
      : await db.contact.update({
          where: { id: existing.id },
          data,
          select: PERSON_CONTACT_SELECT,
        });

  await recordConsentTransitions({
    db,
    contactId: contact.id,
    actor: input.actor,
    actorUserId: input.userId,
    previous: previousConsent,
    next: nextConsent,
    source,
  });
  return finish(contact, previousConsent, nextConsent);
}

/* ------------------------------------------------------------------------- *
 * Checkout phone fill
 *
 * Deliberately NOT `setPersonPhone`. This is a different operation that
 * happens to also write a phone: Stripe checkout carries no consent
 * disclosure, so it never creates a Contact and never writes a consent field.
 * Keep the two functions separate.
 * ------------------------------------------------------------------------- */

export type FillContactPhoneInput = {
  buyerEmail: string | null | undefined;
  phone: string | null | undefined;
};

/** The narrow Prisma surface this fill needs, so callers can inject a fake. */
export type ContactPhoneFillDb = Pick<typeof prisma, "contact">;

/** Fill an existing Contact's blank phone without creating or overwriting one. */
export async function fillContactPhoneFromCheckout(
  input: FillContactPhoneInput,
  db: ContactPhoneFillDb = prisma
): Promise<void> {
  const email = normalizeEmail(input.buyerEmail);
  // Lenient on purpose: a checkout typo must stay visible to staff rather than
  // be dropped, so this uses onboardingPhoneForStorage, not normalizePhoneE164.
  const incomingPhone = onboardingPhoneForStorage(input.phone ?? null);
  if (!email || !incomingPhone) return;

  const contact = await db.contact.findUnique({
    where: { email },
    select: { phone: true },
  });
  if (!contact) return;

  const phone = fillPhoneIfEmpty(contact.phone, incomingPhone);
  if (phone === contact.phone) return;

  // Match the value we read so a concurrent CRM edit cannot be overwritten.
  await db.contact.updateMany({
    where: { email, phone: contact.phone },
    data: { phone },
  });
}

/* ------------------------------------------------------------------------- *
 * Batched read-through joins
 *
 * Contact.userId has no Prisma @relation yet, so these are manual joins. They
 * are batched deliberately: one query per page of users, never one per user.
 * ------------------------------------------------------------------------- */

export type PersonContactState = {
  phone: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
};

/** What a user with no linked Contact looks like — every field present. */
export const EMPTY_PERSON_CONTACT_STATE: PersonContactState = {
  phone: null,
  phoneConsentAt: null,
  smsMarketingConsentAt: null,
  smsTransactionalConsentAt: null,
  smsOptOutAt: null,
  doNotCall: false,
};

/**
 * Contact.userId is deliberately non-unique (one human, two emails — see
 * autoWon.ts). Pick deterministically: the Contact whose email matches the
 * user's own email wins, because that is the record the user themselves
 * maintains through /settings; otherwise the oldest row wins, because it is
 * the longest-standing consent evidence. `id` breaks a createdAt tie so the
 * result never depends on row order.
 */
function pickPersonContact<T extends { id: string; email: string; createdAt: Date }>(
  candidates: T[],
  userEmail: string | null
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const sorted = [...candidates].sort((a, b) => {
    const aMatches = userEmail !== null && normalizeEmail(a.email) === userEmail;
    const bMatches = userEmail !== null && normalizeEmail(b.email) === userEmail;
    if (aMatches !== bMatches) return aMatches ? -1 : 1;
    const byAge = a.createdAt.getTime() - b.createdAt.getTime();
    if (byAge !== 0) return byAge;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

/**
 * Phone + consent state for many users in ONE query.
 *
 * PII: the caller is responsible for the authorization gate. Every consumer
 * today is ADMIN-only; if a caller's authorization ever widens, phone must be
 * dropped from that payload rather than relying on this helper.
 */
export async function resolvePersonContactStates(
  users: readonly { id: string; email: string }[],
  db: ContactPhoneFillDb = prisma
): Promise<Map<string, PersonContactState>> {
  const states = new Map<string, PersonContactState>();
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) return states;

  const contacts = await db.contact.findMany({
    where: { userId: { in: userIds } },
    select: {
      id: true,
      email: true,
      userId: true,
      phone: true,
      phoneConsentAt: true,
      smsMarketingConsentAt: true,
      smsTransactionalConsentAt: true,
      smsOptOutAt: true,
      doNotCall: true,
      createdAt: true,
    },
  });

  const byUserId = new Map<string, typeof contacts>();
  for (const contact of contacts) {
    if (contact.userId === null) continue;
    const bucket = byUserId.get(contact.userId);
    if (bucket) bucket.push(contact);
    else byUserId.set(contact.userId, [contact]);
  }

  for (const user of users) {
    const chosen = pickPersonContact(
      byUserId.get(user.id) ?? [],
      normalizeEmail(user.email)
    );
    states.set(
      user.id,
      chosen
        ? {
            phone: chosen.phone,
            phoneConsentAt: chosen.phoneConsentAt,
            smsMarketingConsentAt: chosen.smsMarketingConsentAt,
            smsTransactionalConsentAt: chosen.smsTransactionalConsentAt,
            smsOptOutAt: chosen.smsOptOutAt,
            doNotCall: chosen.doNotCall,
          }
        : { ...EMPTY_PERSON_CONTACT_STATE }
    );
  }

  return states;
}

/**
 * "Can I text this person" for many emails in ONE query, keyed by normalized
 * email. Returns booleans only — no digits — so a caller that must not see a
 * number cannot leak one. An email with no Contact is not smsable.
 */
export async function resolveSmsableByEmail(
  emails: readonly string[],
  db: ContactPhoneFillDb = prisma
): Promise<Map<string, boolean>> {
  const normalized = [
    ...new Set(
      emails
        .map((email) => normalizeEmail(email))
        .filter((email): email is string => email !== null)
    ),
  ];
  const smsable = new Map<string, boolean>();
  if (normalized.length === 0) return smsable;

  const contacts = await db.contact.findMany({
    where: { email: { in: normalized } },
    select: {
      email: true,
      phone: true,
      smsMarketingConsentAt: true,
      smsTransactionalConsentAt: true,
      smsOptOutAt: true,
    },
  });

  for (const contact of contacts) {
    const key = normalizeEmail(contact.email);
    if (key === null) continue;
    smsable.set(key, smsableReason(contact, "transactional") === null);
  }
  return smsable;
}
