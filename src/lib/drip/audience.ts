// Broadcast audience resolution: union lead, learner, and buyer sources before
// applying the global suppression rules that must win regardless of provenance.

import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { cohortTag, ensureContactForUser } from "./cohortAnchor";
import {
  candidateWhere,
  matchesSegment,
  parseTags,
  type DripSegment,
} from "./segment";

const PAGE_SIZE = 1_000;
const EMAIL_BATCH_SIZE = 500;
const NO_DRIP_TAG = "no-drip";
const USER_SOURCE_TAG = "broadcast:user";
const SELF_PACED_SOURCE_TAG = "broadcast:self-paced";
const MEMBERSHIP_SOURCE_TAG = "broadcast:membership";
const BROADCAST_AUDIENCE_SOURCE = "broadcast-audience";

type AudiencePerson = {
  email: string;
  name: string | null;
  tags: Set<string>;
};

type CohortRef = { id: string; slug: string | null };

export type BroadcastAudience = {
  contactIds: string[];
  /**
   * `leads`, `users`, and `buyers` are the case-insensitive unique emails
   * contributed by each source before the union. `dedup` is the number of
   * cross-source occurrences removed while forming that union. `suppressed`
   * is the number removed from the completed union by the final Contact,
   * unsubscribe, no-drip, staff, and instructor checks.
   */
  counts: {
    leads: number;
    users: number;
    buyers: number;
    dedup: number;
    suppressed: number;
  };
};

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
    throw new Error(`Could not resolve broadcast audience ${label}`, { cause: error });
  }
}

function addPerson(
  people: Map<string, AudiencePerson>,
  emailValue: string | null | undefined,
  name: string | null | undefined,
  tags: Iterable<string> = []
): void {
  const email = normalizeEmail(emailValue);
  if (!email) return;

  const existing = people.get(email);
  if (existing) {
    for (const tag of tags) existing.tags.add(tag);
    if (!existing.name && name?.trim()) existing.name = name.trim();
    return;
  }

  people.set(email, {
    email,
    name: name?.trim() || null,
    tags: new Set(tags),
  });
}

async function resolveLeads(segment: DripSegment, now: Date): Promise<Map<string, AudiencePerson>> {
  const leads = new Map<string, AudiencePerson>();
  let cursor: string | undefined;

  while (true) {
    const page = await withContext("lead candidates", () =>
      prisma.contact.findMany({
        where: candidateWhere(segment, now),
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          source: true,
          tags: true,
          createdAt: true,
          lastActivityAt: true,
          unsubscribedAt: true,
          phone: true,
          phoneConsentAt: true,
          smsMarketingConsentAt: true,
          smsTransactionalConsentAt: true,
          doNotCall: true,
          smsOptOutAt: true,
        },
      })
    );

    for (const contact of page) {
      if (matchesSegment(contact, segment, now)) {
        addPerson(leads, contact.email, contact.name);
      }
    }
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1]?.id;
    if (!cursor) break;
  }
  return leads;
}

async function resolveCohorts(value: DripSegment["cohorts"]): Promise<CohortRef[]> {
  if (!value) return [];
  const cohorts: CohortRef[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await withContext("cohorts", () =>
      prisma.cohort.findMany({
        where:
          value === "any"
            ? {}
            : { OR: [{ id: { in: value } }, { slug: { in: value } }] },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, slug: true },
      })
    );
    cohorts.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1]?.id;
    if (!cursor) break;
  }
  return cohorts;
}

async function addAllUsers(users: Map<string, AudiencePerson>): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page = await withContext("users", () =>
      prisma.user.findMany({
        where: {},
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, email: true, name: true },
      })
    );
    for (const user of page) addPerson(users, user.email, user.name, [USER_SOURCE_TAG]);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1]?.id;
    if (!cursor) break;
  }
}

async function addCohortUsers(
  users: Map<string, AudiencePerson>,
  cohorts: CohortRef[]
): Promise<void> {
  if (!cohorts.length) return;
  const cohortIds = cohorts.map((cohort) => cohort.id);

  let enrollmentCursor: string | undefined;
  while (true) {
    const page = await withContext("cohort enrollments", () =>
      prisma.enrollment.findMany({
        where: { cohortId: { in: cohortIds }, status: { not: "dropped" } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(enrollmentCursor
          ? { cursor: { id: enrollmentCursor }, skip: 1 }
          : {}),
        select: {
          id: true,
          user: { select: { email: true, name: true } },
          cohort: { select: { id: true, slug: true } },
        },
      })
    );
    for (const enrollment of page) {
      addPerson(users, enrollment.user.email, enrollment.user.name, [cohortTag(enrollment.cohort)]);
    }
    if (page.length < PAGE_SIZE) break;
    enrollmentCursor = page[page.length - 1]?.id;
    if (!enrollmentCursor) break;
  }

  let memberCursor: string | undefined;
  while (true) {
    const page = await withContext("cohort group members", () =>
      prisma.groupMember.findMany({
        where: { group: { cohortId: { in: cohortIds } } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(memberCursor ? { cursor: { id: memberCursor }, skip: 1 } : {}),
        select: {
          id: true,
          user: { select: { email: true, name: true } },
          group: { select: { cohort: { select: { id: true, slug: true } } } },
        },
      })
    );
    for (const member of page) {
      addPerson(users, member.user.email, member.user.name, [cohortTag(member.group.cohort)]);
    }
    if (page.length < PAGE_SIZE) break;
    memberCursor = page[page.length - 1]?.id;
    if (!memberCursor) break;
  }
}

async function resolveUsers(
  segment: DripSegment,
  cohorts: CohortRef[]
): Promise<Map<string, AudiencePerson>> {
  const users = new Map<string, AudiencePerson>();
  if (segment.includeUsers) await addAllUsers(users);
  if (segment.cohorts) await addCohortUsers(users, cohorts);
  return users;
}

async function resolveBuyers(segment: DripSegment): Promise<Map<string, AudiencePerson>> {
  const buyers = new Map<string, AudiencePerson>();
  const products = new Set(segment.products ?? []);
  // Product policy treats "all cohorts" as the academy-wide learner audience,
  // which deliberately includes every paid self-paced program buyer.
  if (segment.cohorts === "any") products.add("self-paced");

  if (products.has("self-paced")) {
    let cursor: string | undefined;
    while (true) {
      const page = await withContext("self-paced buyers", () =>
        prisma.payment.findMany({
          where: { status: "paid", programId: { not: null } },
          orderBy: { id: "asc" },
          take: PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            buyerEmail: true,
            buyerName: true,
            programId: true,
            user: { select: { email: true, name: true } },
          },
        })
      );
      for (const payment of page) {
        addPerson(
          buyers,
          payment.user?.email ?? payment.buyerEmail,
          payment.user?.name ?? payment.buyerName,
          [SELF_PACED_SOURCE_TAG]
        );
      }
      if (page.length < PAGE_SIZE) break;
      cursor = page[page.length - 1]?.id;
      if (!cursor) break;
    }
  }

  if (products.has("membership")) {
    let cursor: string | undefined;
    while (true) {
      const page = await withContext("membership buyers", () =>
        prisma.membership.findMany({
          where: { status: "active" },
          orderBy: { id: "asc" },
          take: PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            buyerEmail: true,
            buyerName: true,
            user: { select: { email: true, name: true } },
          },
        })
      );
      for (const membership of page) {
        addPerson(
          buyers,
          membership.user?.email ?? membership.buyerEmail,
          membership.user?.name ?? membership.buyerName,
          [MEMBERSHIP_SOURCE_TAG]
        );
      }
      if (page.length < PAGE_SIZE) break;
      cursor = page[page.length - 1]?.id;
      if (!cursor) break;
    }
  }
  return buyers;
}

async function ensureNonLeadContacts(
  leads: Map<string, AudiencePerson>,
  users: Map<string, AudiencePerson>,
  buyers: Map<string, AudiencePerson>,
  now: Date
): Promise<void> {
  const people = new Map<string, AudiencePerson>();
  for (const source of [users, buyers]) {
    for (const person of source.values()) {
      addPerson(people, person.email, person.name, person.tags);
    }
  }

  for (const person of people.values()) {
    // The shared helper is intentionally used for existing Contacts too: its
    // update is tag-add-only, preserving lead attribution while making every
    // non-lead audience source inspectable in the CRM.
    await withContext(`Contact for ${person.email}`, () =>
      ensureContactForUser(person.email, person.name, {
        source: BROADCAST_AUDIENCE_SOURCE,
        tags: [...person.tags],
        now,
      })
    );
  }

  // `leads` is accepted to make the ownership boundary explicit: lead Contacts
  // already exist and must not be rewritten merely because they enter a broadcast.
  void leads;
}

async function suppressionSets(emails: string[]): Promise<{
  staff: Set<string>;
  instructors: Set<string>;
}> {
  const staff = new Set<string>();
  for (const batch of chunks(emails, EMAIL_BATCH_SIZE)) {
    const rows = await withContext("management-role suppression", () =>
      prisma.user.findMany({
        where: { email: { in: batch } },
        take: EMAIL_BATCH_SIZE,
        select: { email: true, role: true, roles: true },
      })
    );
    for (const user of rows) {
      if (hasAnyRole(user, MANAGE_ROLES)) staff.add(normalizeEmail(user.email));
    }
  }

  const instructors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const rows = await withContext("cohort-instructor suppression", () =>
      prisma.cohortInstructor.findMany({
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, instructor: { select: { email: true } } },
      })
    );
    for (const row of rows) instructors.add(normalizeEmail(row.instructor.email));
    if (rows.length < PAGE_SIZE) break;
    cursor = rows[rows.length - 1]?.id;
    if (!cursor) break;
  }
  return { staff, instructors };
}

/** Resolve a broadcast recipient union and apply all global suppressions last. */
export async function resolveBroadcastAudience(
  segment: DripSegment,
  options: { now?: Date } = {}
): Promise<BroadcastAudience> {
  const now = options.now ?? new Date();
  const leads = await resolveLeads(segment, now);
  const cohorts = await resolveCohorts(segment.cohorts);
  const users = await resolveUsers(segment, cohorts);
  const buyers = await resolveBuyers(segment);

  await ensureNonLeadContacts(leads, users, buyers, now);

  const union = new Map<string, AudiencePerson>();
  for (const source of [leads, users, buyers]) {
    for (const person of source.values()) addPerson(union, person.email, person.name, person.tags);
  }

  const emails = [...union.keys()];
  const { staff, instructors } = await suppressionSets(emails);
  const contacts = new Map<
    string,
    { id: string; email: string; tags: string | null; unsubscribedAt: Date | null }
  >();
  for (const batch of chunks(emails, EMAIL_BATCH_SIZE)) {
    const rows = await withContext("final Contact suppression pass", () =>
      prisma.contact.findMany({
        where: { email: { in: batch } },
        take: EMAIL_BATCH_SIZE,
        select: { id: true, email: true, tags: true, unsubscribedAt: true },
      })
    );
    for (const contact of rows) contacts.set(normalizeEmail(contact.email), contact);
  }

  const contactIds: string[] = [];
  let suppressed = 0;
  for (const email of emails) {
    const contact = contacts.get(email);
    const blocked =
      !contact ||
      contact.unsubscribedAt !== null ||
      parseTags(contact.tags).includes(NO_DRIP_TAG) ||
      staff.has(email) ||
      instructors.has(email);
    if (blocked) suppressed += 1;
    else contactIds.push(contact.id);
  }

  return {
    contactIds,
    counts: {
      leads: leads.size,
      users: users.size,
      buyers: buyers.size,
      dedup: leads.size + users.size + buyers.size - union.size,
      suppressed,
    },
  };
}
