import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { enrollInCohortReminderCampaigns } from "@/lib/drip/cohortAnchor";
import { groupSeatInclude, seatsTaken } from "@/lib/seats";

// POST /api/cohorts/[id]/enroll — student self-enrollment into a group
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasRole(session?.user, "STUDENT")) {
    return NextResponse.json(
      { error: "Only students can self-enroll" },
      { status: 403 }
    );
  }

  const userId = (session.user as { id: string }).id;

  try {
    const { id: cohortParam } = await params;
    // Accept a clean-URL slug or a cuid.
    const resolvedCohort = await prisma.cohort.findFirst({
      where: { OR: [{ id: cohortParam }, { slug: cohortParam }] },
      select: { id: true },
    });
    if (!resolvedCohort) {
      return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    }
    const cohortId = resolvedCohort.id;
    const { groupId } = await req.json();

    if (!groupId) {
      return NextResponse.json(
        { error: "groupId is required" },
        { status: 400 }
      );
    }

    // Same capacity arithmetic as the public list, the detail page and the
    // checkout guard: members plus pending, unexpired Stripe holds.
    const group = await prisma.group.findFirst({
      where: { id: groupId, cohortId },
      select: { id: true, price: true, seats: true, ...groupSeatInclude(new Date()) },
    });

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (group.price > 0) {
      return NextResponse.json({ requiresPayment: true }, { status: 402 });
    }

    if (seatsTaken(group) >= group.seats) {
      return NextResponse.json({ error: "Group is full" }, { status: 409 });
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Already in this group" },
        { status: 409 }
      );
    }

    await prisma.$transaction([
      prisma.groupMember.create({ data: { groupId, userId } }),
      prisma.enrollment.upsert({
        where: { userId_cohortId: { userId, cohortId } },
        create: { userId, cohortId },
        update: {},
      }),
    ]);

    // Pre-start reminder sequence — best-effort, never throws.
    const enrollee = session.user as { email?: string | null; name?: string | null };
    if (enrollee.email) {
      await enrollInCohortReminderCampaigns(enrollee.email, enrollee.name ?? null, cohortId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Self-enroll error:");
    return NextResponse.json({ error: "Failed to enroll" }, { status: 500 });
  }
}
