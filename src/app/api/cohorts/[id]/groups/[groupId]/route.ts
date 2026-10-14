import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// PUT /api/cohorts/[id]/groups/[groupId]
export async function PUT(
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

    // Check if instructor is assigned to this cohort
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      const cohort = await prisma.cohort.findUnique({
        where: { id: cohortId },
        include: { instructors: { select: { id: true } } },
      });

      if (!cohort) {
        return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
      }

      const isAssigned = cohort.instructors.some(inst => inst.id === userId);
      if (!isAssigned) {
        return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
      }
    }
    const body = await req.json();
    const { name, inPerson, price, seats, allowOneOnOne } = body;

    // Parse boolean values properly
    let parsedInPerson = inPerson;
    let parsedAllowOneOnOne = allowOneOnOne;

    if (typeof inPerson === "string") {
      parsedInPerson = inPerson === "true" || inPerson === "1";
    }
    if (typeof allowOneOnOne === "string") {
      parsedAllowOneOnOne = allowOneOnOne === "true" || allowOneOnOne === "1";
    }

    // Validate numeric fields
    let parsedPrice: number | undefined = price !== undefined ? parseFloat(price) : undefined;
    let parsedSeats: number | undefined = seats !== undefined ? parseFloat(seats) : undefined;

    if (price !== undefined && parsedPrice !== undefined && (isNaN(parsedPrice) || parsedPrice < 0)) {
      return NextResponse.json(
        { error: "Price must be a valid number >= 0" },
        { status: 400 }
      );
    }

    if (seats !== undefined && parsedSeats !== undefined && (isNaN(parsedSeats) || parsedSeats < 0)) {
      return NextResponse.json(
        { error: "Seats must be a valid number >= 1" },
        { status: 400 }
      );
    }

    const group = await prisma.group.update({
      where: { id: groupId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(inPerson !== undefined ? { inPerson: parsedInPerson } : {}),
        ...(price !== undefined ? { price: parsedPrice } : {}),
        ...(seats !== undefined ? { seats: parsedSeats } : {}),
        ...(allowOneOnOne !== undefined ? { allowOneOnOne: parsedAllowOneOnOne } : {}),
      },
    });

    return NextResponse.json(group);
  } catch (error) {
    logger.error({ err: error }, "Update group error:");
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to update group", details: errorMessage },
      { status: 500 }
    );
  }
}

// DELETE /api/cohorts/[id]/groups/[groupId]
export async function DELETE(
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

  // Only ADMIN and TEAM_MEMBER can delete groups, not INSTRUCTOR
  if (!hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    return NextResponse.json({ error: "Only admins can delete groups" }, { status: 403 });
  }

  try {
    const { groupId } = await params;
    await prisma.group.delete({ where: { id: groupId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Delete group error:");
    return NextResponse.json(
      { error: "Failed to delete group" },
      { status: 500 }
    );
  }
}
