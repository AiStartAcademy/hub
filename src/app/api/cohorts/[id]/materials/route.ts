import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Unwrap params:
    const { id: cohortId } = await params;
    const { title, type, url } = await req.json();

    // Find the current max order
    const maxOrderMat = await prisma.cohortMaterial.findFirst({
      where: { cohortId },
      orderBy: { order: 'desc' }
    });
    const nextOrder = maxOrderMat ? maxOrderMat.order + 1 : 0;

    const material = await prisma.cohortMaterial.create({
      data: {
        cohortId,
        title,
        type,
        url,
        order: nextOrder,
      },
    });

    // Update cohort's updatedAt timestamp
    await prisma.cohort.update({
      where: { id: cohortId },
      data: { updatedAt: new Date() }
    });

    return NextResponse.json(material);
  } catch (error) {
    logger.error({ err: error }, "[COHORT_MATERIAL_POST]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Unwrap params:
    const { id: cohortId } = await params;
    const { items } = await req.json(); // Array of { id: string, order: number }

    const updates = items.map((item: { id: string; order: number }) =>
      prisma.cohortMaterial.update({
        where: { id: item.id },
        data: { order: item.order },
      })
    );

    await prisma.$transaction(updates);

    // Update cohort's updatedAt
    await prisma.cohort.update({
      where: { id: cohortId },
      data: { updatedAt: new Date() }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "[COHORT_MATERIAL_REORDER]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}