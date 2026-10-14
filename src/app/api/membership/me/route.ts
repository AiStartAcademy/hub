import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMembershipSnapshot, GRACE_DAYS } from "@/lib/entitlements";
import { MEMBERSHIP_TIER_CONFIG } from "@/lib/membershipTiers";

// GET /api/membership/me — the signed-in user's membership state, for the
// Settings membership panel and other client surfaces. Read-only.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await getMembershipSnapshot(userId);

  return NextResponse.json({
    isMember: snap.isMember,
    tier: snap.tier,
    tierLabel: snap.tier ? MEMBERSHIP_TIER_CONFIG[snap.tier].label : null,
    status: snap.status,
    inGrace: snap.inGrace,
    graceDays: GRACE_DAYS,
    currentPeriodEnd: snap.currentPeriodEnd,
    hasBilling: Boolean(snap.stripeCustomerId),
    canChangePlan: Boolean(snap.stripeSubscriptionId),
  });
}
