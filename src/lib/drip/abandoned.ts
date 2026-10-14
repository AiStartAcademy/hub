// src/lib/drip/abandoned.ts
// Materializes abandoned cohort, program and membership checkouts as leads so the drip engine
// can reach them.
//
// Why this exists: Stripe checkout creates a `Payment` or `Membership` row but deliberately
// does NOT create a `Contact` — the buyer is a Stripe guest, not a lead. The drip engine only
// ever enrolls `Contact` rows, so without this bridge an abandoned cart is invisible to every
// campaign. This job is the one place the two worlds are joined.
//
// Invariants:
//
//  1. **Idempotent on email.** `Contact.email` is unique and the write is an upsert, so
//     re-running is free. There is no `syncedAt` marker to keep honest.
//  2. **Never overwrite first-touch identity.** On an existing lead we only union tags and
//     bump `lastActivityAt`. `source`, `status` and `attribution` are left alone — an
//     onboarding-quiz lead who later abandons a cart is still an onboarding lead, and
//     their original UTM attribution is the truthful one.
//  3. **Buyers are not abandoners.** Anyone with a paid Payment or a live Membership is
//     skipped, and if they already carry a Payment-abandonment tag they are moved to WON —
//     which is what exits them from the campaign (`exitOnStatuses` defaults to WON/LOST).
//  4. **Unsubscribe wins.** An unsubscribed contact is never touched at all.

import prisma from "@/lib/prisma";
import { parseTags } from "./segment";

/** Marks a lead as having abandoned a checkout. Also the campaign's exit bookkeeping key. */
export const ABANDONED_TAG = "checkout-abandoned";
/** Segment `sources` value the cart-recovery campaign targets. */
export const ABANDONED_SOURCE = "checkout_abandoned";
/** Membership (subscription) abandonment — different offer, its own campaign/copy. */
export const MEMBERSHIP_ABANDONED_TAG = "membership-abandoned";
export const MEMBERSHIP_ABANDONED_SOURCE = "membership_abandoned";
/** Program abandonment — the self-paced offer has its own segment and recovery copy. */
export const PROGRAM_ABANDONED_TAG = "program-abandoned";
export const PROGRAM_ABANDONED_SOURCE = "program_checkout_abandoned";

/** Ignore carts older than this — recovering a two-month-old checkout reads as spam. */
const LOOKBACK_DAYS = 30;
/** Per-run cap, in line with the engine's other per-tick caps. */
const DEFAULT_LIMIT = 200;

export type AbandonedSyncResult = {
  /** Candidate payments considered after the buyer filter. */
  scanned: number;
  /** Contacts newly created. */
  created: number;
  /** Existing contacts whose tags/activity were refreshed. */
  updated: number;
  /** Contacts flipped to WON because they have since paid. */
  won: number;
  /** Emails skipped: already bought, or unsubscribed. */
  skipped: number;
  errors: string[];
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nameFor(buyerName: string | null, email: string): string {
  const trimmed = buyerName?.trim();
  if (trimmed) return trimmed;
  const local = email.split("@")[0] ?? "";
  return local || "Guest";
}

/**
 * Turn recent abandoned cohort and program checkouts into leads tagged for cart recovery,
 * and retire their tags for anyone who has since paid.
 *
 * Membership/Accelerator checkouts come from their own table — different offer, different
 * copy — and flow through their own segment and campaign below.
 */
export async function syncAbandonedCheckouts(
  options: { now?: Date; limit?: number } = {}
): Promise<AbandonedSyncResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const result: AbandonedSyncResult = {
    scanned: 0,
    created: 0,
    updated: 0,
    won: 0,
    skipped: 0,
    errors: [],
  };

  // Database calls deliberately have no application timeout: a partial buyer lookup could
  // mail someone who already paid, so Prisma/database cancellation owns the wait and query
  // failures propagate rather than degrading to an incomplete result set.
  // Abandoned == the webhook flipped it to `failed` on session.expired, or it is still
  // `pending` past its seat-reservation expiry (the webhook can be late or never fire).
  const candidates = await prisma.payment.findMany({
    where: {
      buyerEmail: { not: null },
      createdAt: { gte: since },
      AND: [
        {
          OR: [{ cohortId: { not: null } }, { programId: { not: null } }],
        },
        {
          OR: [
            { status: "failed" },
            { status: "pending", expiresAt: { lt: now } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      buyerEmail: true,
      buyerName: true,
      attribution: true,
      segment: true,
      createdAt: true,
      cohortId: true,
      programId: true,
      cohort: { select: { slug: true, id: true } },
    },
    take: limit * 4, // headroom: many rows collapse to one email
  });

  // Membership checkouts abandon too: the webhook parks them as `expired`, or
  // they sit `pending` past their TTL when the webhook is late/never fires.
  const membershipCandidates = await prisma.membership.findMany({
    where: {
      buyerEmail: { not: null },
      createdAt: { gte: since },
      OR: [
        { status: "expired" },
        { status: "pending", expiresAt: { lt: now } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      buyerEmail: true,
      buyerName: true,
      attribution: true,
      segment: true,
      createdAt: true,
      tier: true,
    },
    take: limit * 2,
  });

  type Candidate = {
    buyerEmail: string | null;
    buyerName: string | null;
    attribution: string | null;
    segment: string | null;
    createdAt: Date;
    cohortId?: string | null;
    programId?: string | null;
    cohort?: { slug: string | null; id: string } | null;
    tier?: string;
    kind: "cohort" | "membership" | "program";
  };

  function sourceFor(kind: Candidate["kind"]): string {
    switch (kind) {
      case "cohort":
        return ABANDONED_SOURCE;
      case "membership":
        return MEMBERSHIP_ABANDONED_SOURCE;
      case "program":
        return PROGRAM_ABANDONED_SOURCE;
    }
  }

  // Most recent abandoned cart per email wins — that is the offer they actually
  // wanted. Cohort and program carts compete by recency; either Payment cart beats
  // a membership cart for the same email because the membership pass only fills gaps.
  const latestByEmail = new Map<string, Candidate>();
  for (const payment of candidates) {
    if (!payment.buyerEmail) continue;
    const email = normalizeEmail(payment.buyerEmail);
    if (!email) continue;
    if (!latestByEmail.has(email)) {
      // A row should never point at both offers. If one does, the dated cohort seat is
      // the higher-intent purchase and wins the discriminator.
      const kind: Candidate["kind"] = payment.cohortId ? "cohort" : "program";
      latestByEmail.set(email, { ...payment, kind });
    }
    if (latestByEmail.size >= limit) break;
  }
  for (const membership of membershipCandidates) {
    if (latestByEmail.size >= limit) break;
    if (!membership.buyerEmail) continue;
    const email = normalizeEmail(membership.buyerEmail);
    if (!email || latestByEmail.has(email)) continue;
    latestByEmail.set(email, { ...membership, kind: "membership" });
  }
  if (latestByEmail.size === 0) return result;

  const emails = [...latestByEmail.keys()];

  // Buyers: any paid Payment, or a Membership that is not pending/canceled.
  const [paid, members] = await Promise.all([
    prisma.payment.findMany({
      where: { status: "paid", buyerEmail: { in: emails } },
      select: { buyerEmail: true },
    }),
    prisma.membership.findMany({
      where: { status: { in: ["active", "past_due"] }, buyerEmail: { in: emails } },
      select: { buyerEmail: true },
    }),
  ]);
  const buyers = new Set(
    [...paid, ...members]
      .map((row) => (row.buyerEmail ? normalizeEmail(row.buyerEmail) : ""))
      .filter(Boolean)
  );

  const existingContacts = await prisma.contact.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, tags: true, unsubscribedAt: true, status: true },
  });
  const contactByEmail = new Map(
    existingContacts.map((c) => [normalizeEmail(c.email), c])
  );

  for (const [email, payment] of latestByEmail) {
    const existing = contactByEmail.get(email);

    // Unsubscribe wins before anything else, including the WON bookkeeping.
    if (existing?.unsubscribedAt) {
      result.skipped += 1;
      continue;
    }

    // They bought. Retire the tag's effect by marking WON so the campaign exits them.
    if (buyers.has(email)) {
      result.skipped += 1;
      const existingTags = parseTags(existing?.tags);
      if (
        existing &&
        existing.status !== "WON" &&
        (existingTags.includes(ABANDONED_TAG) ||
          existingTags.includes(PROGRAM_ABANDONED_TAG))
      ) {
        try {
          await prisma.contact.update({
            where: { id: existing.id },
            data: { status: "WON", lastActivityAt: now },
          });
          result.won += 1;
        } catch (error) {
          result.errors.push(`won:${email}:${(error as Error).message}`);
        }
      }
      continue;
    }

    result.scanned += 1;

    const tags = new Set(parseTags(existing?.tags));
    if (payment.kind === "membership") {
      tags.add(MEMBERSHIP_ABANDONED_TAG);
      if (payment.tier) tags.add(`tier-${payment.tier.toLowerCase()}`);
    } else if (payment.kind === "program") {
      tags.add(PROGRAM_ABANDONED_TAG);
      // `Program` has no slug, so its id is the only stable per-item segmentation key —
      // and `programId` already carries it, so no join is needed. The candidate query
      // guarantees it is set for this kind; the guard is what tells the compiler that.
      if (payment.programId) tags.add(`program-${payment.programId}`);
    } else {
      tags.add(ABANDONED_TAG);
      // `Cohort.slug` is nullable — fall back to the id so a slugless cohort still gets a
      // tag, rather than silently losing per-cohort segmentation. Same rule as register-free.
      const cohortKey = payment.cohort?.slug || payment.cohort?.id;
      if (cohortKey) tags.add(`cohort-${cohortKey}`);
    }
    if (payment.segment) tags.add(`seg-${payment.segment}`);
    const serializedTags = JSON.stringify([...tags]);

    try {
      if (existing) {
        // Union tags + refresh activity only. Identity fields stay as they were.
        await prisma.contact.update({
          where: { id: existing.id },
          data: { tags: serializedTags, lastActivityAt: payment.createdAt },
        });
        result.updated += 1;
      } else {
        await prisma.contact.create({
          data: {
            email,
            name: nameFor(payment.buyerName, email),
            status: "NEW",
            source: sourceFor(payment.kind),
            attribution: payment.attribution ?? null,
            tags: serializedTags,
            lastActivityAt: payment.createdAt,
          },
        });
        result.created += 1;
      }
    } catch (error) {
      result.errors.push(`sync:${email}:${(error as Error).message}`);
    }
  }

  return result;
}
