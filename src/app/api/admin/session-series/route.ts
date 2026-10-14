import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { createSeries, SeriesInputError } from "@/lib/seriesAdmin";

/** List every series with its attachments — the admin index. */
export async function GET() {
  const session = await auth();
  if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const series = await prisma.sessionSeries.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      instructor: { select: { id: true, name: true, email: true } },
      cohorts: { include: { cohort: { select: { id: true, title: true, status: true } } } },
      _count: { select: { occurrences: true } },
    },
  });

  return NextResponse.json({ series });
}

/**
 * Create a series. Zoom is NOT provisioned here — that is a separate, explicit step
 * so a mistyped schedule does not immediately mint a real recurring meeting on the
 * single shared Zoom host account.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const created = await createSeries(await req.json());
    return NextResponse.json({ success: true, series: created }, { status: 201 });
  } catch (error) {
    if (error instanceof SeriesInputError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
    logger.error({ err: error }, "[SESSION_SERIES_POST]");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
