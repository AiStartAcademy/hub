import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; materialId: string }> }
) {
  try {
    const session = await auth();
    
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Unwrap params:
    const { id: cohortId, materialId } = await params;

    await prisma.cohortMaterial.delete({
      where: { 
        id: materialId, 
        cohortId: cohortId 
      },
    });

    // Update cohort's updatedAt
    await prisma.cohort.update({
      where: { id: cohortId },
      data: { updatedAt: new Date() }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "[COHORT_MATERIAL_DELETE]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}