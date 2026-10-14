// src/app/api/media/[...path]/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  createGCSReadStream,
  getGCSObjectMetadata,
  nodeReadableToWebStream,
} from "@/lib/gcs";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { checkProgramAccess } from "@/lib/programAccess";
import { logger } from "@/lib/logger";

// ─── GCS streaming helper ─────────────────────────────────────────────────────

function parseByteRangeHeader(
  rangeHeader: string,
  fileSize: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const start = Number.parseInt(match[1], 10);
  const requestedEnd =
    match[2].length > 0 ? Number.parseInt(match[2], 10) : Number.NaN;
  const end = Number.isNaN(requestedEnd)
    ? Math.min(start + 1024 * 1024 - 1, fileSize - 1)
    : requestedEnd;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

async function streamFromGCS(objectKey: string, req: NextRequest): Promise<NextResponse> {
  try {
    const { contentType, size: fileSize } = await getGCSObjectMetadata(objectKey);

    const rangeHeader = req.headers.get("range");

    if (rangeHeader) {
      const range = parseByteRangeHeader(rangeHeader, fileSize);
      if (!range) {
        return NextResponse.json(
          { error: "Invalid Range header" },
          {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
          }
        );
      }

      const { start, end } = range;
      const chunkSize = end - start + 1;
      const stream = createGCSReadStream(objectKey, { start, end });

      return new NextResponse(nodeReadableToWebStream(stream), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    }

    const stream = createGCSReadStream(objectKey);

    return new NextResponse(nodeReadableToWebStream(stream), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, `[media] Proxy error for key=${objectKey}:`);
    return NextResponse.json({ error: "Failed to fetch file" }, { status: 500 });
  }
}

// ─── Access control ───────────────────────────────────────────────────────────

const STAFF_ROLES = new Set(["ADMIN", "INSTRUCTOR", "TEAM_MEMBER"]);

/**
 * Resolves programId for a courses/ object key by looking up the lesson.
 * Returns null if no lesson found (e.g. cover image).
 */
async function getProgramIdForCourseKey(
  objectKey: string
): Promise<string | null> {
  const lesson = await prisma.lesson.findFirst({
    where: {
      OR: [
        { videoUrl: { contains: objectKey } },
        { audioUrl: { contains: objectKey } },
        { captionsUrl: { contains: objectKey } },
        { dataUrl: { contains: objectKey } },
      ],
    },
    select: { module: { select: { programId: true } } },
  });
  return lesson?.module.programId ?? null;
}

async function isAuthorizedForCohortFile(
  userId: string,
  objectKey: string
): Promise<boolean> {
  // Cohort cover images are always public
  if (objectKey.includes("/covers/")) return true;

  if (objectKey.includes("/materials/")) {
    const material = await prisma.cohortMaterial.findFirst({
      where: { url: { contains: objectKey } },
      select: { cohortId: true },
    });

    if (!material) {
      console.warn(`[media] Material not found in DB for key: ${objectKey}`);
      return false;
    }

    const directEnrollment = await prisma.enrollment.findFirst({
      where: { userId, cohortId: material.cohortId, status: "active" },
      select: { id: true },
    });
    if (directEnrollment) return true;

    const groupEnrollment = await prisma.group.findFirst({
      where: {
        cohortId: material.cohortId,
        members: { some: { userId } },
      },
      select: { id: true },
    });
    return groupEnrollment !== null;
  }

  return false;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const objectKey = path.join("/");

  // PDF thumbnails are always public — img tags don't send cookies.
  // "files/previews/" is the legacy location (kept for old rows);
  // "media/{ns}/{slug}/previews/" is the current one.
  if (
    objectKey.startsWith("files/previews/") ||
    (objectKey.startsWith("media/") && objectKey.includes("/previews/"))
  ) {
    logger.info(`[media] Public thumbnail: ${objectKey}`);
    return streamFromGCS(objectKey, req);
  }

  // ── Course files: check program accessMode first ──────────────────────
  if (objectKey.startsWith("courses/")) {
    // Cover images for courses are always public (used in course cards)
    if (objectKey.includes("/covers/")) {
      return streamFromGCS(objectKey, req);
    }

    const programId = await getProgramIdForCourseKey(objectKey);

    if (!programId) {
      // No lesson found — likely a cover or orphaned file, allow if authenticated
      console.warn(`[media] No lesson found for key: ${objectKey}, requiring auth`);
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return streamFromGCS(objectKey, req);
    }

    // Get session (may be null for public courses)
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    const role = (session?.user as { role?: string } | undefined)?.role ?? "";

    // Staff always has access
    if (userId && STAFF_ROLES.has(role)) {
      return streamFromGCS(objectKey, req);
    }

    // Use unified access check — handles public/auth/direct/cohort
    const { hasAccess } = await checkProgramAccess(programId, userId);

    if (!hasAccess) {
      console.warn(
        `[media] Access denied: userId=${userId ?? "guest"} programId=${programId} key=${objectKey}`
      );
      return NextResponse.json(
        { error: userId ? "Forbidden" : "Unauthorized" },
        { status: userId ? 403 : 401 }
      );
    }

    logger.info(
      `[media] Access granted: userId=${userId ?? "guest"} programId=${programId} key=${objectKey}`
    );
    return streamFromGCS(objectKey, req);
  }

  // ── All other files: require authentication ───────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id;
  const role = (session.user as { role?: string }).role ?? "STUDENT";

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (STAFF_ROLES.has(role)) {
    return streamFromGCS(objectKey, req);
  }

  if (objectKey.startsWith("cohorts/")) {
    const allowed = await isAuthorizedForCohortFile(userId, objectKey);
    if (!allowed) {
      console.warn(`[media] Cohort access denied: userId=${userId} key=${objectKey}`);
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return streamFromGCS(objectKey, req);
  }

  // Unknown key format — allow authenticated users through
  console.warn(`[media] Unknown key format, allowing authenticated user: ${objectKey}`);
  return streamFromGCS(objectKey, req);
}
