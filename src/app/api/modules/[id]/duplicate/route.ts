import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { duplicateModuleFull } from "@/lib/duplicateUtils";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
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
  // targetProgramId optional — defaults to same program
  const body = await req.json().catch(() => ({})) as { targetProgramId?: string };

  try {
    const sourceModule = await prisma.module.findUnique({
      where: { id },
      select: { programId: true },
    });
    if (!sourceModule) return NextResponse.json({ error: "Module not found" }, { status: 404 });

    const targetProgramId = body.targetProgramId ?? sourceModule.programId;

    // Create job
    const job = await prisma.duplicateJob.create({
      data: {
        type: "module",
        status: "running",
        progress: 0,
        message: "Starting...",
      },
    });

    logger.info(`[API] Duplicate module job ${job.id} created for module ${id}`);

    // Run async (don't await — return job id immediately)
    (async () => {
      try {
        const newModuleId = await duplicateModuleFull({
          moduleId: id,
          targetProgramId,
          onProgress: async (progress, message) => {
            await prisma.duplicateJob.update({
              where: { id: job.id },
              data: { progress, message },
            });
          },
        });

        await prisma.duplicateJob.update({
          where: { id: job.id },
          data: {
            status: "done",
            progress: 100,
            resultId: newModuleId,
            resultUrl: `/courses/${targetProgramId}`,
          },
        });

        revalidatePath(`/courses/${targetProgramId}`);
        revalidatePath(`/courses/${sourceModule.programId}`);
        logger.info(`[API] Duplicate module job ${job.id} done, newModuleId=${newModuleId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err: message }, `[API] Duplicate module job ${job.id} failed:`);
        await prisma.duplicateJob.update({
          where: { id: job.id },
          data: { status: "failed", error: message },
        });
      }
    })();

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    logger.error({ err: err }, "[API] Duplicate module setup error:");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start duplication" },
      { status: 500 }
    );
  }
}