// src/lib/entitlements.ts
//
// Single source of truth for "what does this member get". Every membership
// check in the app goes through here — programAccess.ts (accessMode=member),
// recordings.ts, the /members surface, and the member API routes all consume
// this instead of querying Membership directly, so tier rules live in exactly
// one place.
//
// Membership is deliberately orthogonal to roles (see roles.ts): it is an
// entitlement, not an identity. Staff (MANAGE_ROLES) bypass every gate, which
// mirrors the pre-existing recordings behavior.

import prisma from "@/lib/prisma";
import type { MembershipTier } from "@/lib/membershipTiers";
import { MANAGE_ROLES, hasAnyRole, type RoleSource } from "@/lib/roles";

export type EntitlementKey =
  | "recordings"
  | "community" // members-lounge chat
  | "weeklyQa"
  | "memberLibrary" // full template/workflow library (MENTOR_NETWORK sees teasers)
  | "pod"
  | "coachingCalls"
  | "dealDesk"
  | "buildSprint"
  | "milestoneLadder"; // achievement tracking (view is open to all members)

export const TIER_RANK: Record<MembershipTier, number> = {
  MENTOR_NETWORK: 1,
  ACCELERATOR: 2,
};

/** Days after currentPeriodEnd during which a past_due member keeps access. */
export const GRACE_DAYS = 7;

const ENTITLEMENT_MIN_TIER: Record<EntitlementKey, MembershipTier> = {
  recordings: "MENTOR_NETWORK",
  community: "MENTOR_NETWORK",
  weeklyQa: "MENTOR_NETWORK",
  memberLibrary: "ACCELERATOR",
  pod: "ACCELERATOR",
  coachingCalls: "ACCELERATOR",
  dealDesk: "ACCELERATOR",
  buildSprint: "ACCELERATOR",
  milestoneLadder: "ACCELERATOR",
};

export interface MembershipSnapshot {
  /** Highest-ranked counting tier, or null when not a member. */
  tier: MembershipTier | null;
  status: "none" | "active" | "past_due" | "canceled" | "pending";
  /** active, OR past_due within the grace window. */
  isMember: boolean;
  /** true only while past_due and inside the grace window — drives the banner. */
  inGrace: boolean;
  currentPeriodEnd: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  membershipId: string | null;
}

const NONE: MembershipSnapshot = {
  tier: null,
  status: "none",
  isMember: false,
  inGrace: false,
  currentPeriodEnd: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  membershipId: null,
};

function isKnownTier(tier: string): tier is MembershipTier {
  return tier in TIER_RANK;
}

function withinGrace(currentPeriodEnd: Date | null): boolean {
  if (!currentPeriodEnd) return false;
  const cutoff = new Date(currentPeriodEnd.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  return new Date() <= cutoff;
}

/**
 * Resolve the user's effective membership. A user can hold multiple Membership
 * rows (resubscribes, comps, tier changes via new checkout) — active rows win
 * over past_due, and within a status the higher tier wins.
 */
export async function getMembershipSnapshot(
  userId: string | undefined
): Promise<MembershipSnapshot> {
  if (!userId) return NONE;

  const rows = await prisma.membership.findMany({
    where: { userId, status: { in: ["active", "past_due"] } },
    select: {
      id: true,
      tier: true,
      status: true,
      currentPeriodEnd: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });

  const counting = rows
    .filter((r) => isKnownTier(r.tier))
    .filter((r) => r.status === "active" || withinGrace(r.currentPeriodEnd))
    .sort((a, b) => {
      // active beats past_due; then higher tier wins
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return TIER_RANK[b.tier as MembershipTier] - TIER_RANK[a.tier as MembershipTier];
    });

  const best = counting[0];
  if (!best) return NONE;

  return {
    tier: best.tier as MembershipTier,
    status: best.status as "active" | "past_due",
    isMember: true,
    inGrace: best.status === "past_due",
    currentPeriodEnd: best.currentPeriodEnd,
    stripeCustomerId: best.stripeCustomerId,
    stripeSubscriptionId: best.stripeSubscriptionId,
    membershipId: best.id,
  };
}

export function tierAtLeast(
  snap: MembershipSnapshot,
  min: MembershipTier | string | null | undefined
): boolean {
  if (!snap.isMember || !snap.tier) return false;
  if (!min || !isKnownTier(String(min))) return true; // unknown/absent minimum = any member
  return TIER_RANK[snap.tier] >= TIER_RANK[min as MembershipTier];
}

/** Pure check against an already-loaded snapshot. Staff override built in. */
export function hasEntitlement(
  snap: MembershipSnapshot,
  key: EntitlementKey,
  roles?: RoleSource
): boolean {
  if (roles !== undefined && hasAnyRole(roles, MANAGE_ROLES)) return true;
  return tierAtLeast(snap, ENTITLEMENT_MIN_TIER[key]);
}

/** Convenience: snapshot + the full entitlement map in one call. */
export async function getMembershipEntitlements(
  userId: string | undefined,
  roles?: RoleSource
): Promise<{ snap: MembershipSnapshot; has: Record<EntitlementKey, boolean> }> {
  const snap = await getMembershipSnapshot(userId);
  const has = Object.fromEntries(
    (Object.keys(ENTITLEMENT_MIN_TIER) as EntitlementKey[]).map((key) => [
      key,
      hasEntitlement(snap, key, roles),
    ])
  ) as Record<EntitlementKey, boolean>;
  return { snap, has };
}
