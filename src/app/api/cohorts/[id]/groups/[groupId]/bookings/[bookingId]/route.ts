import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// PATCH /api/cohorts/[id]/groups/[groupId]/bookings/[bookingId]
export async function PATCH(
  req: Request,
  {
    params,
  }: { params: Promise<{ id: string; groupId: string; bookingId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { bookingId } = await params;
    const userId = (session.user as any).id;
    const body = await req.json();
    const { status, meetingLink, instructorNote } = body;

    // Get booking
    const booking = await prisma.oneOnOneBooking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Check authorization
    if (hasRole(session?.user, "STUDENT") && !hasAnyRole(session?.user, MANAGE_ROLES)) {
      if (booking.studentId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Students can only cancel pending bookings
      if (status === "CANCELLED" && booking.status === "PENDING") {
        const updated = await prisma.oneOnOneBooking.update({
          where: { id: bookingId },
          data: { status: "CANCELLED" },
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

        return NextResponse.json(updated);
      } else {
        return NextResponse.json(
          { error: "You can only cancel pending bookings" },
          { status: 400 }
        );
      }
    }

    // Instructor/Manager can approve, reject, or update booking
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Must be the instructor for this booking or admin/team member
    if (
      booking.instructorId !== userId &&
      !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Handle status change
    if (status === "APPROVED") {
      if (!meetingLink) {
        return NextResponse.json(
          { error: "Meeting link is required for approval" },
          { status: 400 }
        );
      }

      const updated = await prisma.oneOnOneBooking.update({
        where: { id: bookingId },
        data: {
          status: "APPROVED",
          meetingLink,
          instructorNote: instructorNote || booking.instructorNote,
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

      // Mark slot as booked only on approval
      await prisma.instructorSlot.update({
        where: { id: booking.slotId },
        data: { isBooked: true },
      });

      return NextResponse.json(updated);
    } else if (status === "REJECTED") {
      const updated = await prisma.oneOnOneBooking.update({
        where: { id: bookingId },
        data: {
          status: "REJECTED",
          instructorNote: instructorNote || booking.instructorNote,
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

      return NextResponse.json(updated);
    } else if (status) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    } else {
      // Update note without changing status
      const updated = await prisma.oneOnOneBooking.update({
        where: { id: bookingId },
        data: {
          ...(instructorNote !== undefined ? { instructorNote } : {}),
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

      return NextResponse.json(updated);
    }
  } catch (error) {
    logger.error({ err: error }, "Update booking error:");
    return NextResponse.json(
      { error: "Failed to update booking" },
      { status: 500 }
    );
  }
}
