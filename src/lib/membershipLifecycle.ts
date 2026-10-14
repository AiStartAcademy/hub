// src/lib/membershipLifecycle.ts
//
// Post-activation side effects for a membership: welcome email, chat access,
// and exiting lead-nurture drip campaigns. Called from the Stripe
// webhook after grantMembership flips a Membership to active.
//
// The welcome email is idempotent via Membership.welcomeSentAt and its failure
// bubbles so Stripe retries recover delivery (mirrors accountSetupSentAt).
// Drip cleanup is best-effort: it logs and swallows errors, because a CRM
// hiccup must never make Stripe re-deliver a grant. Status/timeline promotion
// lives in leads/autoWon so every purchase path uses the same CAS semantics.

import prisma from "@/lib/prisma";
import { sendMail, escapeHtml } from "@/lib/mail";
import { stopEnrollment } from "@/lib/drip/engine";
import { provisionMemberChat } from "@/lib/memberChat";
import {
  MEMBERSHIP_TIER_CONFIG,
  type MembershipTier,
} from "@/lib/membershipTiers";
import { logger } from "@/lib/logger";
import { normalizeEmail } from "@/lib/onboarding-security";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function sendMembershipWelcomeEmail(
  email: string,
  name: string | null,
  tier: MembershipTier
) {
  const config = MEMBERSHIP_TIER_CONFIG[tier];
  const firstName = escapeHtml((name ?? "").split(" ")[0] || "there");
  const isAccelerator = tier === "ACCELERATOR";

  const accelBlock = `
    <p style="color: #4a5568; line-height: 1.6; font-size: 15px;">
      As an Accelerator member you'll be placed in a <strong>pod</strong> — a small
      accountability group with a coach. Expect an invite to your pod channel and
      your first weekly coaching call soon. Come to the deal desk with real
      outreach and real deals; that's what it's for.
    </p>`;

  const recordingsBlock = `
    <p style="color: #4a5568; line-height: 1.6; font-size: 15px;">
      Every recording from every past cohort is now unlocked for you, and new
      sessions land as each cohort runs. Join the weekly Q&amp;A call whenever you
      want a live answer.
    </p>`;

  await sendMail({
    to: email,
    subject: `Welcome to ${config.label} — here's how to start`,
    html: `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background-color:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;padding:40px 30px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
    <h2 style="color:#1a202c;margin-top:0;font-size:22px;">Welcome aboard, ${firstName}!</h2>
    <p style="color:#4a5568;line-height:1.6;font-size:15px;">
      Your <strong>${escapeHtml(config.label)}</strong> membership is active.
      Your members area is ready:
    </p>
    ${isAccelerator ? accelBlock : recordingsBlock}
    <div style="text-align:center;margin:28px 0;">
      <a href="${APP_URL}/members" style="display:inline-block;background-color:#3182ce;color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px;">
        Open your members area
      </a>
    </div>
    <p style="color:#a0aec0;font-size:12px;text-align:center;">
      Manage your plan any time from Settings → Membership. Questions? Just reply
      to this email.
    </p>
  </div>
</body>
</html>`,
  });
}

/**
 * Run once per membership after it becomes active. Safe to call on webhook
 * retries — every effect is idempotent or naturally repeat-safe.
 */
export async function onMembershipActivated(membershipId: string) {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!membership || membership.status !== "active") return;

  const email = membership.user?.email ?? membership.buyerEmail;
  const name = membership.user?.name ?? membership.buyerName;
  const tier = (membership.tier in MEMBERSHIP_TIER_CONFIG
    ? membership.tier
    : "MENTOR_NETWORK") as MembershipTier;

  // 1. Welcome email — idempotent, failure bubbles so Stripe retries recover it.
  if (email && !membership.welcomeSentAt) {
    await sendMembershipWelcomeEmail(email, name, tier);
    await prisma.membership.update({
      where: { id: membership.id },
      data: { welcomeSentAt: new Date() },
    });
  }

  // 2. Chat provisioning — best-effort (internally catch-logged).
  if (membership.userId) {
    await provisionMemberChat(membership.userId);
  }

  // 3. Drip exit — best-effort. Purchases from people who were never leads do
  // not create Contact rows solely for cleanup.
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  try {
    const contact = await prisma.contact.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (!contact) return;

    // A paying member should not keep receiving lead-nurture sequences.
    const activeEnrollments = await prisma.dripEnrollment.findMany({
      where: { contactId: contact.id, status: "ACTIVE" },
      select: { id: true },
    });
    for (const enrollment of activeEnrollments) {
      await stopEnrollment(enrollment.id, "membership_activated");
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), membershipId },
      "Membership drip cleanup failed (non-fatal)"
    );
  }
}
