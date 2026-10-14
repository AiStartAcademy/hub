import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import {
  addUserToGroup,
  DuplicateGroupMembershipError,
} from "@/lib/groupMembership";


// GET /api/cohorts/[id]/groups/[groupId]/members — list members
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;
    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(members);
  } catch (error) {
    logger.error({ err: error }, "Fetch group members error:");
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

// POST /api/cohorts/[id]/groups/[groupId]/members — add member
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;

  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: cohortId, groupId } = await params;
    const body: unknown = await req.json();
    const newUserId =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { userId?: unknown }).userId
        : undefined;

    if (typeof newUserId !== "string" || !newUserId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: newUserId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Verify group and cohort exist
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { cohort: { include: { instructors: { select: { id: true } } } } },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    // The URL cohort is what gets enrolled into, so the group must belong to it. Without this an
    // instructor of one cohort could enroll anyone into another through their own group.
    if (group.cohortId !== cohortId) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Check if instructor is assigned to this cohort
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      const isAssigned = group.cohort.instructors.some(inst => inst.id === userId);
      if (!isAssigned) {
        return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
      }
    }

    // Check if already a member. Uses newUserId, not userId.
    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: newUserId } },
    });
    
    if (existing) {
      return NextResponse.json(
        { error: "User is already in this group" },
        { status: 409 }
      );
    }

    const member = await addUserToGroup(newUserId, groupId, cohortId);

    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateGroupMembershipError) {
      return NextResponse.json(
        { error: "User is already in this group" },
        { status: 409 }
      );
    }
    logger.error({ err: error }, "Add group member error:");
    return NextResponse.json(
      { error: "Failed to add member" },
      { status: 500 }
    );
  }
}
