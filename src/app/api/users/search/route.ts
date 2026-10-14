import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

// GET /api/users/search?q=...  — search users by name or email
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";

  try {
    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
            ],
          }
        : {},
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        roles: true,
      },
      take: 20,
      orderBy: { name: "asc" },
    });

    return NextResponse.json(users);
  } catch (error) {
    logger.error({ err: error }, "Search users error:");
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
