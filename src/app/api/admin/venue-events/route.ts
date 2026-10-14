import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/client";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["PENDING", "APPROVED", "DECLINED", "CANCELLED", "ALL"]);
const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type VenueEventWithAdminRelations = Prisma.VenueEventGetPayload<{
  include: {
    _count: { select: { registrations: true } };
    agreements: {
      orderBy: { createdAt: "desc" };
      take: 1;
      select: {
        id: true;
        status: true;
        templateKey: true;
        token: true;
        signedAt: true;
      };
    };
  };
}>;

type JsonScalar = string | number | boolean | null;
type JsonObject = Record<string, JsonScalar>;

function parseDateParam(value: string, paramName: "from" | "to"): Date | null {
  if (!DATE_PARAM_PATTERN.test(value)) {
    throw new Error(`Invalid ${paramName}`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${paramName}`);
  }

  return date;
}

function serializeScalarRecord(record: Record<string, unknown>): JsonObject {
  const serialized: JsonObject = {};

  for (const [key, value] of Object.entries(record)) {
    if (value instanceof Date) {
      serialized[key] = value.toISOString();
      continue;
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      serialized[key] = value;
      continue;
    }

    serialized[key] = null;
  }

  return serialized;
}

function serializeLatestAgreement(
  agreement: VenueEventWithAdminRelations["agreements"][number] | undefined,
): JsonObject | null {
  if (!agreement) {
    return null;
  }

  return serializeScalarRecord(agreement);
}

interface SerializedVenueEvent {
  [key: string]: JsonScalar | JsonObject | null | number;
  registrationCount: number;
  latestAgreement: JsonObject | null;
}

function serializeVenueEvent(event: VenueEventWithAdminRelations): SerializedVenueEvent {
  const { _count, agreements, ...scalars } = event;

  return {
    ...serializeScalarRecord(scalars),
    registrationCount: _count.registrations,
    latestAgreement: serializeLatestAgreement(agreements[0]),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();

  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status") ?? "PENDING";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const qParam = searchParams.get("q");

  if (!ALLOWED_STATUSES.has(statusParam)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  let fromDate: Date | null = null;
  let toDate: Date | null = null;

  try {
    fromDate = fromParam ? parseDateParam(fromParam, "from") : null;
  } catch {
    return NextResponse.json({ error: "Invalid from" }, { status: 400 });
  }

  try {
    toDate = toParam ? parseDateParam(toParam, "to") : null;
  } catch {
    return NextResponse.json({ error: "Invalid to" }, { status: 400 });
  }

  if (qParam !== null && qParam.length === 0) {
    return NextResponse.json({ error: "Invalid q" }, { status: 400 });
  }

  const where: Prisma.VenueEventWhereInput = {};

  if (statusParam !== "ALL") {
    where.status = statusParam;
  }

  if (fromDate || toDate) {
    where.date = {};

    if (fromDate) {
      where.date.gte = fromDate;
    }

    if (toDate) {
      const inclusiveToDate = new Date(toDate);
      inclusiveToDate.setUTCDate(inclusiveToDate.getUTCDate() + 1);
      where.date.lt = inclusiveToDate;
    }
  }

  if (qParam) {
    where.OR = [
      { title: { contains: qParam } },
      { orgName: { contains: qParam } },
    ];
  }

  try {
    const events = await prisma.venueEvent.findMany({
      where,
      orderBy: { date: "asc" },
      take: 500,
      include: {
        _count: { select: { registrations: true } },
        agreements: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            templateKey: true,
            token: true,
            signedAt: true,
          },
        },
      },
    });

    return NextResponse.json(events.map(serializeVenueEvent));
  } catch (err: unknown) {
    logger.error({ err }, "[admin-venue-events] list failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
