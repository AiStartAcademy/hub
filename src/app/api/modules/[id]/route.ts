// /api/modules/[id]/route.ts

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { checkProgramAccess } from "@/lib/programAccess";
import { logger } from "@/lib/logger";

// GET /api/modules/[id]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();
    const user = session?.user as { id?: string; role?: string } | undefined;
    const userId = user?.id;
    const userRole = user?.role;

    // First fetch module to get programId for access check
    const module = await prisma.module.findUnique({
      where: { id },
      include: {
        lessons: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            duration: true,
            order: true,
          },
        },
        assessments: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            order: true,
          },
        },
      },
    });

    if (!module) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    // Check access to the parent program
    const isStaff = userRole === "ADMIN" || userRole === "TEAM_MEMBER" || userRole === "INSTRUCTOR";
    
    let hasAccess = false;
    let isPublicNoAuth = false;

    if (isStaff) {
      // Grant full structural access to managers/admins
      hasAccess = true;
      logger.info(`[modules GET] Access granted natively for staff role: ${userRole}`);
    } else {
      // Regular check for students and guests
      const accessResult = await checkProgramAccess(module.programId, userId);
      hasAccess = accessResult.hasAccess;
      isPublicNoAuth = accessResult.isPublicNoAuth;
    }

    if (!hasAccess) {
      logger.info(
        `[modules GET] Access denied: userId=${userId ?? "guest"} role=${userRole ?? "none"} moduleId=${id} programId=${module.programId}`
      );
      // Return 401 for guests so client can redirect to login,
      // 403 for authenticated users without access
      return NextResponse.json(
        { error: userId ? "Forbidden" : "Unauthorized" },
        { status: userId ? 403 : 401 }
      );
    }

    logger.info(
      `[modules GET] Access granted: userId=${userId ?? "guest"} moduleId=${id} isPublicNoAuth=${isPublicNoAuth}`
    );

    return NextResponse.json(module);
  } catch (error) {
    logger.error({ err: error }, "[modules GET] Fetch module error:");
    return NextResponse.json(
      { error: "Failed to fetch module" },
      { status: 500 }
    );
  }
}