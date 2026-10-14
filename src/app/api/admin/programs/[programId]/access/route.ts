// src/app/api/admin/programs/[programId]/access/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


async function requireAdmin() {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) return null;
  return session;
}

// GET /api/admin/programs/[programId]/access
// Returns program accessMode config + list of users with direct access
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ programId: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { programId } = await params;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      accessMode: true,
      memberMinTier: true,
      accessList: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!program) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }

  logger.info(`[ProgramAccess GET] programId=${programId}, mode=${program.accessMode}, directUsers=${program.accessList.length}`);

  return NextResponse.json(program);
}

// PATCH /api/admin/programs/[programId]/access
// Update accessMode / requireAuth
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ programId: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { programId } = await params;
  const body = await req.json() as { accessMode?: string; memberMinTier?: string | null };

  const validModes = ["cohort", "direct", "auth", "public", "member"];
  if (body.accessMode && !validModes.includes(body.accessMode)) {
    return NextResponse.json({ error: "Invalid accessMode" }, { status: 400 });
  }

  const validTiers = ["MENTOR_NETWORK", "ACCELERATOR"];
  if (
    "memberMinTier" in body &&
    body.memberMinTier != null &&
    !validTiers.includes(body.memberMinTier)
  ) {
    return NextResponse.json({ error: "Invalid memberMinTier" }, { status: 400 });
  }

  const program = await prisma.program.update({
    where: { id: programId },
    data: {
      ...(body.accessMode !== undefined && { accessMode: body.accessMode }),
      ...("memberMinTier" in body && { memberMinTier: body.memberMinTier ?? null }),
    },
    select: { id: true, accessMode: true, memberMinTier: true },
  });

  logger.info(`[ProgramAccess PATCH] programId=${programId}, accessMode=${program.accessMode}, memberMinTier=${program.memberMinTier ?? "any"}`);

  return NextResponse.json(program);
}

// POST /api/admin/programs/[programId]/access
// Add a user to direct access list
export async function POST(
  req: Request,
  { params }: { params: Promise<{ programId: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { programId } = await params;
  const { userId } = await req.json() as { userId: string };

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const access = await prisma.programAccess.upsert({
    where: { programId_userId: { programId, userId } },
    update: {},
    create: { programId, userId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  logger.info(`[ProgramAccess POST] Granted direct access: userId=${userId}, programId=${programId}`);

  return NextResponse.json(access, { status: 201 });
}

// DELETE /api/admin/programs/[programId]/access?userId=xxx
// Remove a user from direct access list
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ programId: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { programId } = await params;
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }

  await prisma.programAccess.deleteMany({
    where: { programId, userId },
  });

  logger.info(`[ProgramAccess DELETE] Revoked direct access: userId=${userId}, programId=${programId}`);

  return NextResponse.json({ success: true });
}
