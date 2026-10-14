// src/lib/chat/provisionUser.ts
//
// One place that guarantees a hub user has a Rocket.Chat account and that we
// remember its id. Every chat surface (cohort panel, /chat, members lounge)
// funnels through here so the "sync once, then reuse" behaviour is identical.

import { prisma } from "@/lib/prisma";
import { RocketChatService } from "@/lib/rocketchat";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

export type ChatProvisionUser = {
  id: string;
  name?: string | null;
  email: string;
  rocketchatId?: string | null;
};

/**
 * Returns the user's Rocket.Chat id, creating the RC account on first use.
 * Returns null if RC is unreachable — callers should degrade, not throw.
 */
export async function provisionChatUser(
  user: ChatProvisionUser,
  role: "guest" | "user" = "guest",
): Promise<string | null> {
  if (user.rocketchatId) return user.rocketchatId;

  const rcUserId = await RocketChatService.syncUser(user.name || "User", user.email, role);
  if (!rcUserId) return null;

  await prisma.user.update({
    where: { id: user.id },
    data: { rocketchatId: rcUserId },
  });
  return rcUserId;
}

/**
 * Staff are invited into every cohort group so they can answer students.
 * Only worth paying for when a group is first created — on an existing group
 * this would be a per-pageview N+1 against the RC API.
 */
export async function provisionStaffChatIds(): Promise<string[]> {
  // `roles` is a JSON string[] and `role` is the legacy single value, so the DB
  // filter is a coarse net (either column mentioning a staff role) and
  // hasAnyRole() does the real decision in memory — never compare .role directly.
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: MANAGE_ROLES } },
        ...MANAGE_ROLES.map((r) => ({ roles: { contains: r } })),
      ],
    },
    select: { id: true, name: true, email: true, rocketchatId: true, role: true, roles: true },
  });

  const ids: string[] = [];
  for (const member of candidates) {
    if (!hasAnyRole(member, MANAGE_ROLES)) continue;
    const rcId = await provisionChatUser(member, "user");
    if (rcId) ids.push(rcId);
  }
  return ids;
}
