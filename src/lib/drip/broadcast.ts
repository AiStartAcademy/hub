import prisma from "@/lib/prisma";
import { resolveBroadcastAudience } from "./audience";
import { parseSegment } from "./segment";
import { isUniqueConstraintViolation } from "./prismaErrors";

export type BroadcastCounts = {
  leads: number;
  users: number;
  buyers: number;
  dedup: number;
  suppressed: number;
};

export type BroadcastSendResult =
  | {
      ok: true;
      enrolled: number;
      counts: BroadcastCounts;
      dryRun: boolean;
    }
  | { ok: false; reason: string };

/**
 * Snapshot a broadcast audience and enqueue one drip enrollment per contact.
 * Delivery remains tick()'s job, preserving DripSend idempotency, unsubscribe
 * handling, tracking, and campaign send-window behavior.
 */
export async function sendBroadcast(
  campaignId: string,
  options: { dryRun?: boolean; sendAt?: Date; now?: Date } = {}
): Promise<BroadcastSendResult> {
  const now = options.now ?? new Date();

  try {
    const campaign = await prisma.dripCampaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { order: "asc" } } },
    });

    if (!campaign) return { ok: false, reason: "Campaign not found" };
    if (campaign.status !== "DRAFT" && campaign.status !== "ACTIVE") {
      return {
        ok: false,
        reason: `Campaign status ${campaign.status} cannot be sent`,
      };
    }
    if (!campaign.steps.length) {
      return { ok: false, reason: "Campaign has no steps" };
    }

    const audience = await resolveBroadcastAudience(
      parseSegment(campaign.segment),
      { now }
    );
    if (!audience.contactIds.length) {
      return { ok: false, reason: "Broadcast audience is empty" };
    }

    if (options.dryRun) {
      return {
        ok: true,
        enrolled: audience.contactIds.length,
        counts: audience.counts,
        dryRun: true,
      };
    }

    // SQLite's Prisma connector rejects createMany({ skipDuplicates }), so
    // enroll one row at a time and tolerate only a duplicate-key collision —
    // an already-enrolled contact is skipped, not counted, and not an error.
    let enrolledCount = 0;
    for (const contactId of audience.contactIds) {
      try {
        await prisma.dripEnrollment.create({
          data: {
            campaignId: campaign.id,
            contactId,
            cohortId: "",
            status: "ACTIVE",
            lastStepOrder: 0,
            enrolledAt: now,
            nextRunAt: options.sendAt ?? now,
          },
        });
        enrolledCount += 1;
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;
      }
    }
    const enrollment = { count: enrolledCount };

    await prisma.dripCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "ACTIVE",
        sentAt: now,
        audienceSnapshot: JSON.stringify(audience),
      },
    });

    return {
      ok: true,
      enrolled: enrollment.count,
      counts: audience.counts,
      dryRun: false,
    };
  } catch (error) {
    throw new Error(`Failed to send broadcast campaign ${campaignId}`, {
      cause: error,
    });
  }
}
