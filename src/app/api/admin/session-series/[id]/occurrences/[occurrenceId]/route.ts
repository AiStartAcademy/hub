import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";
import { SeriesInputError, updateOccurrence } from "@/lib/seriesAdmin";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; occurrenceId: string }> }
) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const { id: seriesId, occurrenceId } = await params;

    const occurrence = await updateOccurrence(seriesId, occurrenceId, await req.json());
    return NextResponse.json({ success: true, occurrence });
  } catch (error) {
    if (error instanceof SeriesInputError) {
      const status = error.message === "Occurrence not found" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.error({ err: error }, "[SERIES_OCCURRENCE_PATCH]");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
