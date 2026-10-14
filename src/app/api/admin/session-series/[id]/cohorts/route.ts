import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { SeriesInputError, setSeriesCohorts } from "@/lib/seriesAdmin";

/** Set which cohorts this series serves. Takes the FULL desired set, not a delta. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { id: seriesId } = await params;
    const body = await req.json();

    if (!Array.isArray(body.cohortIds)) {
      return NextResponse.json({ error: "cohortIds must be an array" }, { status: 400 });
    }

    const cohorts = await setSeriesCohorts(seriesId, body.cohortIds);
    return NextResponse.json({ success: true, cohorts });
  } catch (error) {
    if (error instanceof SeriesInputError) {
      const status = error.message === "Series not found" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.error({ err: error }, "[SESSION_SERIES_COHORTS_PUT]");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
