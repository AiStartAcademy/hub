import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { moveModuleFull } from "@/lib/duplicateUtils";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { targetProgramId } = await req.json() as { targetProgramId: string };

  if (!targetProgramId) {
    return NextResponse.json({ error: "targetProgramId is required" }, { status: 400 });
  }

  try {
    const module = await prisma.module.findUnique({
      where: { id },
      select: { programId: true, name: true },
    });
    if (!module) return NextResponse.json({ error: "Module not found" }, { status: 404 });

    logger.info(`[API] Moving module ${id} to program ${targetProgramId}`);
    await moveModuleFull({ moduleId: id, targetProgramId });

    revalidatePath(`/courses/${module.programId}`);
    revalidatePath(`/courses/${targetProgramId}`);

    return NextResponse.json({ success: true, targetProgramId });
  } catch (err) {
    logger.error({ err: err }, "[API] Move module error:");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to move module" },
      { status: 500 }
    );
  }
}