import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RocketChatService } from "@/lib/rocketchat";
import { logger } from "@/lib/logger";
import { canAccessCohortChat, cohortChannelName } from "@/lib/chat/cohortChatAccess";
import { provisionChatUser, provisionStaffChatIds } from "@/lib/chat/provisionUser";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: cohortId } = await params;

    const [user, cohort] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.user.id } }),
      prisma.cohort.findUnique({ where: { id: cohortId } }),
    ]);
    if (!user || !cohort) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Same membership rule as the cohort page selector: a group seat or an
    // enrollment row makes you a member; staff always pass. Without this, any
    // signed-in user could mint a token AND get invited into a private group.
    const [groupMemberCount, enrollmentCount] = await Promise.all([
      prisma.groupMember.count({ where: { userId: user.id, group: { cohortId: cohort.id } } }),
      prisma.enrollment.count({ where: { userId: user.id, cohortId: cohort.id } }),
    ]);

    if (!canAccessCohortChat({ user, groupMemberCount, enrollmentCount })) {
      return NextResponse.json({ error: "Not enrolled in this cohort" }, { status: 403 });
    }

    const rcUserId = await provisionChatUser(user);
    if (!rcUserId) throw new Error("Failed to sync user with chat server");

    // The group name is derived from the title only the first time. After that
    // we reuse the persisted name, so renaming a cohort keeps its history.
    const isFirstProvision = !cohort.rocketchatGroupId;

    // Backfill for groups created before we stored the name: ask RC what the
    // room is actually called rather than re-deriving from a possibly-renamed
    // title, which would silently create a second, empty group.
    let knownName = cohort.rocketchatChannelName;
    if (!knownName && cohort.rocketchatGroupId) {
      knownName = await RocketChatService.getGroupNameById(cohort.rocketchatGroupId);
    }
    const channelName = cohortChannelName({ ...cohort, rocketchatChannelName: knownName });

    // Staff get invited into every cohort group so they can answer students —
    // but only when the group is first created. Doing it on every request was
    // one RC round-trip per staff account per page view.
    const memberIds = isFirstProvision
      ? [rcUserId, ...(await provisionStaffChatIds())]
      : [rcUserId];

    const groupId = await RocketChatService.syncGroup(channelName, memberIds);

    if (groupId && (cohort.rocketchatGroupId !== groupId || !cohort.rocketchatChannelName)) {
      await prisma.cohort.update({
        where: { id: cohort.id },
        data: { rocketchatGroupId: groupId, rocketchatChannelName: channelName },
      });
    }

    const authToken = await RocketChatService.createIframeToken(user.email);

    return NextResponse.json({ authToken, channelName, chatUrl: process.env.RC_URL });
  } catch (error) {
    logger.error({ err: error }, "[Chat API Error]:");
    const message = error instanceof Error ? error.message : "Error connecting to chat";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
