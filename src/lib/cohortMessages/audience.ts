// Cohort message audience: everyone enrolled in one cohort (plus, on request,
// its instructors), each with a Contact and their per-channel consent status.
//
// Deliberately not resolveBroadcastAudience: that resolver drops every
// instructor and applies the MARKETING unsubscribe. A cohort message is a
// course-scope logistics update, so email is gated by the course opt-out and
// SMS by transactional consent (see src/lib/drip/emailScope.ts and
// smsableReason in src/lib/phone.ts).

import prisma from "@/lib/prisma";
import { hasAnyRole, type RoleValue } from "@/lib/roles";
import { smsableReason, type SmsabilityReason } from "@/lib/phone";
import { ensureContactForUser } from "@/lib/drip/cohortAnchor";
import { emailScopeReason, type EmailScopeReason } from "@/lib/drip/emailScope";

const PAGE_SIZE = 1_000;
const EMAIL_BATCH_SIZE = 500;
const CONTACT_SOURCE = "cohort-message";

/**
 * Staff who are never messaged as members of a cohort, even when they are
 * enrolled in it or teach it. INSTRUCTOR is a management role too, but it is
 * governed by the explicit `includeInstructors` switch instead.
 */
const ALWAYS_EXCLUDED_ROLES: readonly RoleValue[] = ["ADMIN", "TEAM_MEMBER"];

export type CohortMessageRecipientKind = "student" | "instructor";

export type CohortMessageRecipient = {
  /** Null only in read-only (preview) mode for a person who has no Contact yet. */
  contactId: string | null;
  name: string;
  email: string;
  kind: CohortMessageRecipientKind;
  /** Why course email would not be delivered, or null when it would. */
  emailReason: EmailScopeReason | null;
  /** Why a transactional SMS would not be delivered, or null when it would. */
  smsReason: SmsabilityReason | null;
};

export type CohortMessageAudience = {
  cohort: { id: string; slug: string | null; title: string };
  recipients: CohortMessageRecipient[];
};

export type ResolveCohortMessageAudienceOptions = {
  includeInstructors: boolean;
  /**
   * true (send): provision a Contact for every person missing one.
   * false (preview): read only — a person without a Contact is reported with
   * contactId null and the consent a freshly created Contact would have.
   */
  ensureContacts: boolean;
  now?: Date;
};

type AudienceUser = {
  email: string;
  name: string | null;
  role: string | null;
  roles: string | null;
};

type Person = { email: string; name: string | null; kind: CohortMessageRecipientKind };

type ConsentContact = {
  id: string;
  email: string;
  name: string | null;
  unsubscribedAt: Date | null;
  courseEmailOptOutAt: Date | null;
  phone: string | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
};

const CONSENT_CONTACT_SELECT = {
  id: true,
  email: true,
  name: true,
  unsubscribedAt: true,
  courseEmailOptOutAt: true,
  phone: true,
  smsMarketingConsentAt: true,
  smsTransactionalConsentAt: true,
  smsOptOutAt: true,
} as const;

const USER_SELECT = { email: true, name: true, role: true, roles: true } as const;

/** The consent a Contact created right now would carry: no opt-outs, no SMS consent. */
const FRESH_CONTACT_CONSENT = {
  unsubscribedAt: null,
  courseEmailOptOutAt: null,
  phone: null,
  smsMarketingConsentAt: null,
  smsTransactionalConsentAt: null,
  smsOptOutAt: null,
} as const;

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function withContext<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`Could not resolve cohort message audience: ${label}`, { cause: error });
  }
}

/**
 * Role filter shared by students and instructors. Admins and team members are
 * never included; instructor-role users only when instructors were requested.
 */
function isAllowedRecipient(user: AudienceUser, includeInstructors: boolean): boolean {
  if (hasAnyRole(user, ALWAYS_EXCLUDED_ROLES)) return false;
  if (!includeInstructors && hasAnyRole(user, ["INSTRUCTOR"])) return false;
  return true;
}

function addPerson(
  people: Map<string, Person>,
  user: AudienceUser,
  kind: CohortMessageRecipientKind
): void {
  const email = normalizeEmail(user.email);
  if (!email) return;
  const existing = people.get(email);
  if (existing) {
    if (!existing.name && user.name?.trim()) existing.name = user.name.trim();
    if (kind === "instructor") existing.kind = "instructor";
    return;
  }
  people.set(email, { email, name: user.name?.trim() || null, kind });
}

async function collectStudents(
  cohortId: string,
  people: Map<string, Person>,
  includeInstructors: boolean
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page = await withContext("enrollments", () =>
      prisma.enrollment.findMany({
        where: { cohortId, status: { not: "dropped" } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, user: { select: USER_SELECT } },
      })
    );
    for (const row of page) {
      if (row.user && isAllowedRecipient(row.user, includeInstructors)) {
        addPerson(people, row.user, "student");
      }
    }
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1]?.id;
    if (!cursor) break;
  }
}

async function loadContacts(emails: string[]): Promise<Map<string, ConsentContact>> {
  const contacts = new Map<string, ConsentContact>();
  for (const batch of chunks(emails, EMAIL_BATCH_SIZE)) {
    const rows = await withContext("contacts", () =>
      prisma.contact.findMany({
        where: { email: { in: batch } },
        take: EMAIL_BATCH_SIZE,
        select: CONSENT_CONTACT_SELECT,
      })
    );
    for (const row of rows) contacts.set(normalizeEmail(row.email), row);
  }
  return contacts;
}

/**
 * Resolve who a cohort message reaches and whether each channel would deliver.
 * Returns null when the cohort does not exist. Never filters on consent: a
 * person whose email or SMS is blocked stays in the list with the reason, so
 * the preview can name them and the engine can record the skip.
 */
export async function resolveCohortMessageAudience(
  cohortId: string,
  options: ResolveCohortMessageAudienceOptions
): Promise<CohortMessageAudience | null> {
  const now = options.now ?? new Date();
  const cohort = await withContext("cohort", () =>
    prisma.cohort.findUnique({
      where: { id: cohortId },
      select: { id: true, slug: true, title: true, instructors: { select: USER_SELECT } },
    })
  );
  if (!cohort) return null;

  const people = new Map<string, Person>();
  await collectStudents(cohort.id, people, options.includeInstructors);
  if (options.includeInstructors) {
    for (const instructor of cohort.instructors) {
      if (isAllowedRecipient(instructor, true)) addPerson(people, instructor, "instructor");
    }
  }

  const emails = [...people.keys()];
  const contacts = await loadContacts(emails);

  if (options.ensureContacts) {
    const missing = emails.filter((email) => !contacts.has(email));
    for (const email of missing) {
      const person = people.get(email);
      // Only people without a Contact are provisioned. ensureContactForUser
      // bumps lastActivityAt on an existing row, which a cohort message is not.
      await withContext(`Contact for ${email}`, () =>
        ensureContactForUser(email, person?.name ?? null, { source: CONTACT_SOURCE, now })
      );
    }
    if (missing.length) {
      for (const [email, contact] of await loadContacts(missing)) contacts.set(email, contact);
    }
  }

  const recipients: CohortMessageRecipient[] = [];
  for (const person of people.values()) {
    const contact = contacts.get(person.email);
    const consent = contact ?? FRESH_CONTACT_CONSENT;
    recipients.push({
      contactId: contact?.id ?? null,
      name: person.name ?? contact?.name?.trim() ?? person.email,
      email: person.email,
      kind: person.kind,
      emailReason: emailScopeReason(consent, "course"),
      smsReason: smsableReason(consent, "transactional"),
    });
  }

  return {
    cohort: { id: cohort.id, slug: cohort.slug, title: cohort.title },
    recipients,
  };
}
