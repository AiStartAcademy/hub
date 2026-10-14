import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getMembershipSnapshot, hasEntitlement } from "@/lib/entitlements";
import { provisionMemberChat, MEMBERS_LOUNGE_GROUP } from "@/lib/memberChat";
import { RocketChatService } from "@/lib/rocketchat";
import { logger } from "@/lib/logger";

// GET /api/members/chat — members-lounge iframe token. Mirrors the cohort chat
// token route, gated on the `community` entitlement.
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const snap = await getMembershipSnapshot(userId);
    if (!hasEntitlement(snap, "community", session?.user)) {
      return NextResponse.json({ error: "Membership required" }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await provisionMemberChat(userId);
    const authToken = await RocketChatService.createIframeToken(user.email);

    return NextResponse.json({
      authToken,
      channelName: MEMBERS_LOUNGE_GROUP,
      chatUrl: process.env.RC_URL,
    });
  } catch (error) {
    logger.error({ err: error }, "[Members Chat API Error]:");
    return NextResponse.json({ error: "Error connecting to chat" }, { status: 500 });
  }
}
