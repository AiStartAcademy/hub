import { NextRequest, NextResponse } from "next/server";
import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import { getMembershipSnapshot } from "@/lib/entitlements";
import {
  MEMBERSHIP_TIER_CONFIG,
  type MembershipTier,
} from "@/lib/membershipTiers";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { getSecret } from "@/lib/secrets";
import { logger } from "@/lib/logger";

// POST /api/membership/change-tier — switches the member's subscription to a
// different tier by updating the subscription item's price IN PLACE (with
// prorations). Deliberately writes nothing to the database: the
// customer.subscription.updated webhook is the only writer of membership state
// and syncs tier/amount from the new price id.
export async function POST(req: NextRequest) {
  if (!stripeConfigured) {
    return NextResponse.json(
      { error: "Payments are not configured" },
      { status: 500 }
    );
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { tier?: string };
    const tier = body.tier;
    if (tier !== "MENTOR_NETWORK" && tier !== "ACCELERATOR") {
      return NextResponse.json(
        { error: "Invalid tier. Expected MENTOR_NETWORK or ACCELERATOR." },
        { status: 400 }
      );
    }
    const target = tier as MembershipTier;

    const snap = await getMembershipSnapshot(userId);
    if (!snap.isMember || !snap.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 404 }
      );
    }
    if (snap.tier === target) {
      return NextResponse.json(
        { error: `You are already on the ${MEMBERSHIP_TIER_CONFIG[target].label} plan.` },
        { status: 409 }
      );
    }

    const priceId = await getSecret(MEMBERSHIP_TIER_CONFIG[target].priceIdEnvVar);
    if (!priceId) {
      return NextResponse.json(
        { error: `Plan changes are not available right now. Contact ${brand.email.contact}.` },
        { status: 503 }
      );
    }

    const subscription = await stripe.subscriptions.retrieve(
      snap.stripeSubscriptionId
    );
    if (subscription.status === "canceled") {
      return NextResponse.json(
        { error: "Your subscription has ended — start a new membership instead." },
        { status: 409 }
      );
    }
    const item = subscription.items.data[0];
    if (!item) {
      return NextResponse.json(
        { error: "Subscription has no items to update" },
        { status: 500 }
      );
    }

    await stripe.subscriptions.update(snap.stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "create_prorations",
      metadata: { tier: target },
    });

    logger.info(
      `[change-tier] userId=${userId} subscription=${snap.stripeSubscriptionId} ${snap.tier} -> ${target} (webhook will sync)`
    );

    return NextResponse.json({ ok: true, tier: target });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Membership tier change error"
    );
    return NextResponse.json(
      { error: "Failed to change plan" },
      { status: 500 }
    );
  }
}
