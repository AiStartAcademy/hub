import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMembershipSnapshot } from "@/lib/entitlements";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { logger } from "@/lib/logger";

// POST /api/membership/portal — opens a Stripe Billing Portal session for the
// signed-in member (card updates, invoices, cancel). Plan switching should stay
// disabled in the portal configuration — tier changes go through
// /api/membership/change-tier — but either way the webhook is the only writer
// of membership state, so a portal-side change still syncs correctly.
export async function POST() {
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
    const snap = await getMembershipSnapshot(userId);
    const customerId = snap.stripeCustomerId;
    if (!customerId) {
      return NextResponse.json(
        { error: "No billing account found for your membership" },
        { status: 404 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Billing portal session error"
    );
    return NextResponse.json(
      { error: "Failed to open billing portal" },
      { status: 500 }
    );
  }
}
