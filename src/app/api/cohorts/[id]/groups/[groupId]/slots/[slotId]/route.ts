import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// DELETE /api/cohorts/[id]/groups/[groupId]/slots/[slotId]
export async function DELETE(
  req: Request,
  {
    params,
  }: { params: Promise<{ id: string; groupId: string; slotId: string }> }
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
    const { id: cohortId, slotId } = await params;

    // Get the slot with group and cohort info
    const slot = await prisma.instructorSlot.findUnique({
      where: { id: slotId },
      include: {
        booking: true,
        group: { include: { cohort: { include: { instructors: { select: { id: true } } } } } },
      },
    });

    if (!slot) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    if (slot.group.cohortId !== cohortId) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    // Check if it has an approved booking
    if (
      slot.booking &&
      (slot.booking.status === "APPROVED" || slot.booking.status === "PENDING")
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot delete slot with pending or approved bookings. Cancel the booking first.",
        },
        { status: 400 }
      );
    }

    // Check authorization: instructor owns slot, or admin/team member
    if (slot.instructorId !== userId && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // For instructors, verify they are assigned to the cohort
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      const isAssigned = slot.group.cohort.instructors.some(inst => inst.id === userId);
      if (!isAssigned) {
        return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
      }
    }

    await prisma.instructorSlot.delete({ where: { id: slotId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Delete slot error:");
    return NextResponse.json(
      { error: "Failed to delete slot" },
      { status: 500 }
    );
  }
}
