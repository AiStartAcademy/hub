// src/app/api/chat/unread/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RocketChatService } from "@/lib/rocketchat";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ unread: 0 });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, rocketchatId: true }
    });

    // No chat account yet means no messages
    if (!user?.rocketchatId) {
      return NextResponse.json({ unread: 0 });
    }

    const unreadCount = await RocketChatService.getUnreadCount(user.email, user.rocketchatId);

    
    return NextResponse.json({ unread: unreadCount });
  } catch (error) {
    return NextResponse.json({ unread: 0 });
  }
}