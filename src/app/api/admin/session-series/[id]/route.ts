import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { SeriesInputError, updateSeries } from "@/lib/seriesAdmin";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await params;

  const series = await prisma.sessionSeries.findUnique({
    where: { id },
    include: {
      instructor: { select: { id: true, name: true, email: true } },
      cohorts: { include: { cohort: { select: { id: true, title: true, status: true } } } },
      occurrences: {
        orderBy: { date: "asc" },
        include: { instructor: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!series) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ series });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { id } = await params;

    const updated = await updateSeries(id, await req.json());
    return NextResponse.json({ success: true, series: updated });
  } catch (error) {
    if (error instanceof SeriesInputError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    logger.error({ err: error }, "[SESSION_SERIES_PATCH]");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
