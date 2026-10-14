import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, hasRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// GET /api/cohorts/[id]/groups
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const groups = await prisma.group.findMany({
      where: { cohortId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(groups);
  } catch (error) {
    logger.error({ err: error }, "Fetch groups error:");
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// POST /api/cohorts/[id]/groups
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;
    const body = await req.json();
    const { name, inPerson, price, seats } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Verify cohort exists
    const cohort = await prisma.cohort.findUnique({
      where: { id },
      include: { instructors: { select: { id: true } } },
    });
    if (!cohort) {
      return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    }

    // Check if instructor is assigned to this cohort
    if (hasRole(session?.user, "INSTRUCTOR") && !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      const isAssigned = cohort.instructors.some(inst => inst.id === userId);
      if (!isAssigned) {
        return NextResponse.json({ error: "You are not assigned to this cohort" }, { status: 403 });
      }
    }

    const group = await prisma.group.create({
      data: {
        cohortId: id,
        name: name.trim(),
        inPerson: inPerson ?? false,
        price: price ? parseFloat(price) : 0,
        seats: seats ? parseInt(seats) : 50,
      },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "Create group error:");
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to create group", details: errorMessage },
      { status: 500 }
    );
  }
}
