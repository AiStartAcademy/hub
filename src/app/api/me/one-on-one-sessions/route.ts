import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

// GET /api/me/one-on-one-sessions
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = (session.user as any).id;

    if (!userId) {
      return NextResponse.json({ error: "User ID not found" }, { status: 400 });
    }

    // Get all approved sessions for the current user (as student or instructor)
    const sessions = await prisma.oneOnOneBooking.findMany({
      where: {
        status: "APPROVED",
        OR: [{ studentId: userId }, { instructorId: userId }],
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
        group: {
          select: { id: true, name: true, cohortId: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!sessions || sessions.length === 0) {
      return NextResponse.json([]);
    }

    // Sort by date manually
    const sorted = sessions.sort((a, b) => {
      return new Date(a.slot.date).getTime() - new Date(b.slot.date).getTime();
    });

    // Format response with combined slot and booking info
    const formatted = sorted.map((booking) => ({
      id: booking.id,
      slotId: booking.slotId,
      date: booking.slot.date,
      startTime: booking.slot.startTime,
      endTime: booking.slot.endTime,
      timezone: booking.slot.timezone,
      meetingLink: booking.meetingLink,
      instructor: booking.slot.instructor,
      student: booking.student,
      group: booking.group,
      studentNote: booking.studentNote,
      instructorNote: booking.instructorNote,
      status: booking.status,
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    logger.error({ err: error }, "Fetch one-on-one sessions error:");
    return NextResponse.json(
      { error: "Failed to fetch sessions", details: String(error) },
      { status: 500 }
    );
  }
}
