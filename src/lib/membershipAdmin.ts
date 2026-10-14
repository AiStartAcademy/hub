// src/lib/membershipAdmin.ts
//
// Complimentary-membership administration, shared by the /admin/members server
// actions and the internal MCP memberships route. Invariant preserved: the
// Stripe webhook is the sole writer of PAID membership state — everything here
// only ever creates or cancels COMP rows (stripeSessionId = "comp_<uuid>",
// amount 0), which the webhook can never match.

import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { onMembershipActivated } from "@/lib/membershipLifecycle";
import { logger } from "@/lib/logger";
import { markLeadWonForPurchase } from "@/lib/leads/autoWon";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MEMBERSHIP_TIERS_VALID = ["MENTOR_NETWORK", "ACCELERATOR"] as const;
export type CompTier = (typeof MEMBERSHIP_TIERS_VALID)[number];

export function isCompMembership(stripeSessionId: string): boolean {
  return stripeSessionId.startsWith("comp_");
}

export interface GrantCompInput {
  email: string;
  tier: CompTier;
  /** <= 0 or undefined = open-ended (access until revoked). */
  months?: number;
  /** Who/what granted it, for the audit log line (e.g. "admin:<id>", "mcp"). */
  grantedBy?: string;
}

export async function grantCompMembership(input: GrantCompInput) {
  const email = input.email.trim().toLowerCase();
  const months = input.months ?? 0;
  if (!EMAIL_PATTERN.test(email)) throw new Error("Invalid email");
  if (!MEMBERSHIP_TIERS_VALID.includes(input.tier)) throw new Error("Invalid tier");

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, role: "STUDENT" },
    select: { id: true, name: true, email: true },
  });

  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      buyerEmail: email,
      buyerName: user.name,
      stripeSessionId: `comp_${randomUUID()}`,
      amount: 0,
      currency: "usd",
      tier: input.tier,
      status: "active",
      currentPeriodEnd:
        months > 0 ? new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000) : null,
    },
  });

  logger.info(
    `[membershipAdmin] Comp membership ${membership.id} (${input.tier}) granted to ${email} by ${input.grantedBy ?? "unknown"}`
  );
  // CRM is intentionally fire-and-forget: its failure must not fail a completed
  // grant, where a caller retry could create a duplicate complimentary membership.
  void markLeadWonForPurchase({
    buyerEmail: user.email,
    userId: existing?.id,
    kind: "MEMBERSHIP",
    refId: membership.id,
  }).catch((error: unknown) => {
    logger.error(
      {
        err: error instanceof Error ? error.message : String(error),
        membershipId: membership.id,
        userId: user.id,
      },
      "Lead auto-WON failed after complimentary membership grant (non-fatal)"
    );
  });
  // Welcome email + chat provisioning + drip exit.
  await onMembershipActivated(membership.id);

  return { membership, user, userCreated: !existing };
}

export async function revokeComp(membershipId: string) {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { id: true, stripeSessionId: true, tier: true, buyerEmail: true, status: true },
  });
  if (!membership) throw new Error("Membership not found");
  if (!isCompMembership(membership.stripeSessionId)) {
    // Paid memberships are canceled in Stripe; the webhook syncs the row.
    throw new Error("Only comp memberships can be revoked here");
  }

  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: { status: "canceled" },
    select: { id: true, tier: true, buyerEmail: true, status: true },
  });
  logger.info(`[membershipAdmin] Comp membership ${membership.id} revoked`);
  return updated;
}

export interface ListMembershipsFilter {
  tier?: string;
  status?: string;
  compOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listMemberships(filter: ListMembershipsFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 25));

  const where = {
    ...(filter.tier ? { tier: filter.tier } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.compOnly ? { stripeSessionId: { startsWith: "comp_" } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.membership.count({ where }),
    prisma.membership.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        tier: true,
        status: true,
        amount: true,
        currency: true,
        buyerEmail: true,
        buyerName: true,
        stripeSessionId: true,
        currentPeriodEnd: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((m) => ({
      id: m.id,
      tier: m.tier,
      status: m.status,
      amountCents: m.amount,
      currency: m.currency,
      email: m.user?.email ?? m.buyerEmail,
      name: m.user?.name ?? m.buyerName,
      isComp: isCompMembership(m.stripeSessionId),
      currentPeriodEnd: m.currentPeriodEnd,
      createdAt: m.createdAt,
    })),
  };
}
