// src/app/api/programs/route.ts

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";


// GET /api/programs — list programs (for dropdown/select)
export async function GET() {
  const session = await auth();

  try {
    // Only managers can see all programs
    // Students can only see public/open programs
    const programs = await prisma.program.findMany({
      where: hasAnyRole(session?.user, MANAGE_ROLES)
        ? {} // show all
        : { status: "open" }, // show only open programs
      select: {
        id: true,
        name: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(programs);
  } catch (error) {
    logger.error({ err: error }, "Fetch programs error:");
    return NextResponse.json(
      { error: "Failed to fetch programs" },
      { status: 500 }
    );
  }
}
