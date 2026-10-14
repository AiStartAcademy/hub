import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cohorts = await prisma.cohort.findMany({
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(cohorts);
  } catch (error) {
    logger.error({ err: error }, "[COHORTS_LIST_GET]");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}