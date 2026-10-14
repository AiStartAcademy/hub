"use server";

import prisma from "@/lib/prisma";
import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { hasAnyRole } from "@/lib/roles";
import {
  addDripStep,
  createDripCampaign,
  deleteDripStep,
  duplicateCampaign,
  updateDripCampaignSegment as persistDripCampaignSegment,
  updateDripCampaignSettings,
  updateDripStep,
} from "@/lib/drip/admin";
import { sendBroadcast } from "@/lib/drip/broadcast";
import {
  CAMPAIGN_STATUSES,
  countSegmentMatches,
  enrollContact,
  sendTestStep,
  stopEnrollment,
  tick,
} from "@/lib/drip/engine";
import { parseSegment, type DripSegment } from "@/lib/drip/segment";
import { appUrl } from "@/lib/drip/engine";
import { renderMergeFields } from "@/lib/drip/template";
import { tagLinksInHtml } from "@/lib/drip/link-utm";

async function assertStaff() {
  const session = await auth();
  if (!hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    throw new Error("Unauthorized");
  }
}

function refresh(campaignId?: string) {
  revalidatePath("/admin/contacts/campaigns");
  if (campaignId) revalidatePath(`/admin/contacts/campaigns/${campaignId}`);
}

// ─── Campaigns ───────────────────────────────────────────────────────

export async function createCampaign(name: string) {
  await assertStaff();
  const campaign = await createDripCampaign({ name });
  refresh(campaign.id);
  return campaign.id;
}

export async function sendCampaignBroadcast(
  campaignId: string,
  options?: { dryRun?: boolean }
) {
  await assertStaff();
  const result = await sendBroadcast(campaignId, options);
  refresh(campaignId);
  return result;
}

export async function duplicateCampaignAction(campaignId: string) {
  await assertStaff();
  const campaign = await duplicateCampaign(campaignId);
  refresh(campaign.id);
  return campaign.id;
}

export async function setCampaignStatus(campaignId: string, status: string) {
  await assertStaff();
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Invalid status");
  }

  if (status === "ACTIVE") {
    const steps = await prisma.dripStep.count({ where: { campaignId } });
    if (steps === 0) throw new Error("Add at least one step before activating");
  }

  await prisma.dripCampaign.update({ where: { id: campaignId }, data: { status } });

  // Resuming a campaign has to un-park the enrollments the runner paused when it
  // was stopped, otherwise they sit at nextRunAt = null forever.
  if (status === "ACTIVE") {
    await prisma.dripEnrollment.updateMany({
      where: { campaignId, status: "PAUSED" },
      data: { status: "ACTIVE", nextRunAt: new Date() },
    });
  }
  refresh(campaignId);
}

export async function updateCampaignSettings(
  campaignId: string,
  input: {
    name: string;
    description: string;
    trigger?: string;
    autoEnroll: boolean;
    priority: number;
    timezone: string;
    sendWindowStartHour: number;
    sendWindowEndHour: number;
    skipWeekends: boolean;
    exitOnStatuses: string[];
    testEmail: string;
  }
) {
  await assertStaff();
  await updateDripCampaignSettings(campaignId, input);
  refresh(campaignId);
}

export async function updateCampaignSegment(campaignId: string, segment: DripSegment) {
  await assertStaff();
  await persistDripCampaignSegment(campaignId, segment);
  refresh(campaignId);
}

/** Audience preview for the segment editor — count only, no enrollment. */
export async function previewSegment(segment: DripSegment) {
  await assertStaff();
  return countSegmentMatches(parseSegment(JSON.stringify(segment)));
}

export async function deleteCampaign(campaignId: string) {
  await assertStaff();
  // Cascades to steps, enrollments, and send history — so only a campaign that
  // never actually mailed anyone can be deleted. Archive the rest.
  const sends = await prisma.dripSend.count({
    where: { enrollment: { campaignId } },
  });
  if (sends > 0) {
    throw new Error("This campaign has send history — archive it instead of deleting");
  }
  await prisma.dripCampaign.delete({ where: { id: campaignId } });
  revalidatePath("/admin/contacts/campaigns");
}

// ─── Steps ───────────────────────────────────────────────────────────

export async function addStep(campaignId: string) {
  await assertStaff();
  await addDripStep(campaignId);
  refresh(campaignId);
}

export async function updateStep(
  stepId: string,
  input: {
    delayHours: number;
    anchor?: string;
    offsetMinutes?: number;
    channel: string;
    subject: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    callAssistantId?: string;
    callFirstMessage?: string;
  }
) {
  await assertStaff();
  const step = await updateDripStep(stepId, input);
  refresh(step.campaignId);
  return { warnings: step.warnings };
}

/**
 * Send one step to the campaign's test email. Touches no lead and writes no
 * DripSend row — see sendTestStep in src/lib/drip/engine.ts.
 */
export async function sendStepTest(stepId: string) {
  await assertStaff();
  try {
    const { to, subject } = await sendTestStep(stepId);
    return { ok: true as const, to, subject };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "Test send failed",
    };
  }
}

export async function deleteStep(stepId: string) {
  await assertStaff();
  const step = await deleteDripStep(stepId);
  if (!step) return;
  refresh(step.campaignId);
}

// ─── Enrollments + runner ────────────────────────────────────────────

export async function enrollLead(campaignId: string, email: string) {
  await assertStaff();
  const contact = await prisma.contact.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  if (!contact) return { ok: false as const, reason: "No lead with that email" };
  const result = await enrollContact(campaignId, contact.id);
  refresh(campaignId);
  return result;
}

export async function stopLeadEnrollment(enrollmentId: string, campaignId: string) {
  await assertStaff();
  await stopEnrollment(enrollmentId, "manual");
  refresh(campaignId);
}

/** "Run now" — the same tick the cron calls, for testing without waiting. */
export async function runTickNow() {
  await assertStaff();
  const result = await tick({ sendLimit: 25 });
  revalidatePath("/admin/contacts/campaigns");
  return result;
}

/**
 * Server-rendered preview of a drip step body.
 *
 * The editor used to carry its own eight-token merge map, which drifted from
 * the real send pipeline every time a merge field was added. This runs the
 * actual `renderMergeFields` + `tagLinksInHtml` path instead, so a preview that
 * looks right is evidence the send will be right.
 *
 * No tracking signer is passed: a preview must not mint tracking tokens.
 */
export async function previewDripStepBodyAction(input: {
  body: string;
  campaignSlug: string;
  stepOrder: number;
  upcomingCohortsHtml: string;
  nextCohortLine: string;
}): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  await assertStaff();

  const baseAppUrl = appUrl();
  try {
    const html = renderMergeFields(input.body, {
      name: "Ada Lovelace",
      email: brand.email.preview,
      unsubscribeUrl: `${baseAppUrl}/unsubscribe?token=preview`,
      appUrl: baseAppUrl,
      upcomingCohortsHtml: input.upcomingCohortsHtml,
      nextCohortLine: input.nextCohortLine,
      campaignSlug: input.campaignSlug,
    });
    return {
      ok: true,
      html: tagLinksInHtml(html, {
        campaign: input.campaignSlug,
        stepOrder: input.stepOrder,
        unsubscribeUrl: `${baseAppUrl}/unsubscribe?token=preview`,
      }),
    };
  } catch (error) {
    // A preview failure is cosmetic — surface it, never let it look like a
    // broken campaign.
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not render preview",
    };
  }
}
