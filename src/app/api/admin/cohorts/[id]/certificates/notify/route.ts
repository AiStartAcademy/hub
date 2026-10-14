import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { enrollCertificateNotifications } from "@/lib/drip/certificateNotify";
import { logger } from "@/lib/logger";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

type NotifyBody = {
  certificateIds?: string[];
  dryRun?: boolean;
};

function isNotifyBody(value: unknown): value is NotifyBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const body = value as Record<string, unknown>;
  return (
    (body.certificateIds === undefined ||
      (Array.isArray(body.certificateIds) &&
        body.certificateIds.every((id): id is string => typeof id === "string"))) &&
    (body.dryRun === undefined || typeof body.dryRun === "boolean")
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasAnyRole(session.user, MANAGE_ROLES)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error: unknown) {
    logger.warn({ error }, "[admin-certificate-notify] invalid JSON body");
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isNotifyBody(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { id } = await params;
  try {
    const result = await enrollCertificateNotifications(id, {
      certificateIds: body.certificateIds,
      dryRun: body.dryRun,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    logger.error({ error, cohortId: id }, "[admin-certificate-notify] enrollment failed");
    return NextResponse.json({ error: "Certificate notification enrollment failed" }, { status: 500 });
  }
}
