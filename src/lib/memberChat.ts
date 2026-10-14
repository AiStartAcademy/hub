// src/lib/memberChat.ts
//
// RocketChat provisioning for the members area: the shared members-lounge
// group (every active member) and per-pod private groups. Every function here
// is fire-and-forget safe — it logs and returns null/false on failure, because
// callers include the Stripe webhook, which must never fail on RC downtime.

import prisma from "@/lib/prisma";
import { RocketChatService } from "@/lib/rocketchat";
import { logger } from "@/lib/logger";

export const MEMBERS_LOUNGE_GROUP = "members-lounge";

export function podGroupName(slug: string): string {
  return `pod-${slug.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
}

/** Find-or-create the user's RC account (role `user`, not channel-capped
 *  `guest`) and persist the id. Returns the RC user id or null. */
async function ensureRcUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, rocketchatId: true },
  });
  if (!user) return null;
  if (user.rocketchatId) return user.rocketchatId;

  const rcUserId = await RocketChatService.syncUser(
    user.name || "Member",
    user.email,
    "user"
  );
  if (rcUserId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { rocketchatId: rcUserId },
    });
  }
  return rcUserId;
}

/** Invite a newly-activated member into the members lounge. */
export async function provisionMemberChat(userId: string): Promise<boolean> {
  try {
    const rcUserId = await ensureRcUser(userId);
    if (!rcUserId) return false;
    const roomId = await RocketChatService.syncGroup(MEMBERS_LOUNGE_GROUP, [rcUserId]);
    return Boolean(roomId);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), userId },
      "[memberChat] provisionMemberChat failed (non-fatal)"
    );
    return false;
  }
}

/** Create/repair the pod's private group with all active members + coach, and
 *  persist the room id on the pod. */
export async function provisionPodChannel(podId: string): Promise<boolean> {
  try {
    const pod = await prisma.pod.findUnique({
      where: { id: podId },
      select: {
        id: true,
        slug: true,
        coachId: true,
        members: { where: { leftAt: null }, select: { userId: true } },
      },
    });
    if (!pod) return false;

    const userIds = [
      ...pod.members.map((m) => m.userId),
      ...(pod.coachId ? [pod.coachId] : []),
    ];
    const rcIds: string[] = [];
    for (const userId of userIds) {
      const rcId = await ensureRcUser(userId);
      if (rcId) rcIds.push(rcId);
    }
    if (rcIds.length === 0) return false;

    const roomId = await RocketChatService.syncGroup(podGroupName(pod.slug), rcIds);
    if (roomId) {
      await prisma.pod.update({
        where: { id: pod.id },
        data: { rocketchatGroupId: roomId },
      });
    }
    return Boolean(roomId);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), podId },
      "[memberChat] provisionPodChannel failed (non-fatal)"
    );
    return false;
  }
}
