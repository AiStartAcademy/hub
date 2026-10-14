import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole, isValidRole, serializeRoles } from "@/lib/roles";
import { logger } from "@/lib/logger";

// Accepts either the legacy single `role` (kept for callers that haven't
// migrated) or the new `roles: string[]` multi-select payload. Either way,
// both User.role (primary/display) and User.roles (full set) are written
// together so they never drift out of sync.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();

  if (!hasRole(session?.user, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const rawRoles: unknown[] = Array.isArray(body.roles) ? body.roles : body.role ? [body.role] : [];

    if (rawRoles.length === 0) {
      return NextResponse.json({ error: "At least one role is required" }, { status: 400 });
    }
    if (!rawRoles.every(isValidRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const roles = rawRoles as string[];

    const { userId } = await params;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role: roles[0], roles: serializeRoles(roles) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roles: true,
      }
    });

    return NextResponse.json(user);
  } catch (error) {
    logger.error({ err: error }, "Update role error:");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
