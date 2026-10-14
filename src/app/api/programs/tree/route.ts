// src/app/api/programs/tree/route.ts

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // All programs with modules and lessons (Admin/Team Member)
    // Modules and lessons sorted by order
    const programsTree = await prisma.program.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        modules: {
          orderBy: { order: "asc" },
          include: {
            lessons: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                name: true,
                type: true,
                duration: true,
              }
            }
          }
        }
      }
    });

    return NextResponse.json(programsTree);
  } catch (error) {
    logger.error({ err: error }, "[PROGRAMS_TREE_GET]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}