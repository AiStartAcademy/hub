import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// GET /api/cohorts/[id]/groups/[groupId]/bookings
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: cohortId, groupId } = await params;
    const userId = (session.user as any).id;

    let bookings;

    if (hasAnyRole(session?.user, MANAGE_ROLES)) {
      // Verify cohort exists and check instructor assignment
      const group = await prisma.group.findUnique({
        where: { id: groupId },
        include: { cohort: { include: { instructors: { select: { id: true } } } } },
      });

      if (!group || group.cohortId !== cohortId) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }

      // For instructors, verify they are assigned to the cohort
      if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
        const isAssigned = group.cohort.instructors.some(inst => inst.id === userId);
        if (!isAssigned) {
          return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
        }
      }

      // Instructors see all bookings for the group
      bookings = await prisma.oneOnOneBooking.findMany({
        where: { groupId },
        include: {
          slot: {
            include: {
              instructor: {
                select: { id: true, name: true, email: true, image: true },
              },
            },
          },
          student: {
            select: { id: true, name: true, email: true, image: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    } else {
      // Students see only their own bookings
      bookings = await prisma.oneOnOneBooking.findMany({
        where: { groupId, studentId: userId },
        include: {
          slot: {
            include: {
              instructor: {
                select: { id: true, name: true, email: true, image: true },
              },
            },
          },
          student: {
            select: { id: true, name: true, email: true, image: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    return NextResponse.json(bookings);
  } catch (error) {
    logger.error({ err: error }, "Fetch bookings error:");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// POST /api/cohorts/[id]/groups/[groupId]/bookings
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { groupId } = await params;
    const studentId = (session.user as any).id;
    const body = await req.json();
    const { slotId, studentNote } = body;

    if (!slotId) {
      return NextResponse.json(
        { error: "Slot ID is required" },
        { status: 400 }
      );
    }

    // Verify student is a member of the group
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: studentId } },
    });

    if (!member) {
      return NextResponse.json(
        { error: "You are not a member of this group" },
        { status: 403 }
      );
    }

    // Verify slot exists and is available
    const slot = await prisma.instructorSlot.findUnique({
      where: { id: slotId },
      include: { booking: true },
    });

    if (!slot) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    if (slot.groupId !== groupId) {
      return NextResponse.json(
        { error: "Slot does not belong to this group" },
        { status: 400 }
      );
    }

    // Block if slot already has an approved booking or is marked as booked
    if (slot.isBooked) {
      return NextResponse.json(
        { error: "This slot is already booked" },
        { status: 400 }
      );
    }

    // Check if there's already a pending or approved booking for this slot
    if (slot.booking && (slot.booking.status === "PENDING" || slot.booking.status === "APPROVED")) {
      return NextResponse.json(
        { error: "This slot already has a pending request" },
        { status: 400 }
      );
    }

    // Create booking request (slot stays available until instructor approves)
    const booking = await prisma.oneOnOneBooking.create({
      data: {
        slotId,
        studentId,
        instructorId: slot.instructorId,
        groupId,
        status: "PENDING",
        studentNote: studentNote || null,
      },
      include: {
        slot: {
          include: {
            instructor: {
              select: { id: true, name: true, email: true, image: true },
            },
          },
        },
        student: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "Create booking error:");
    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
