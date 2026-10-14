import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();

  if (!hasRole(session?.user, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await params;

    // Prevent admin from deleting themselves
    if (userId === (session?.user as any)?.id) {
      return NextResponse.json({ error: "You cannot delete yourself" }, { status: 400 });
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Delete user error:");
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
