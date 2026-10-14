// src/app/api/drive/[fileId]/route.ts
import { auth } from "@/lib/auth";
import { getDriveAccessToken, invalidateDriveTokenCache } from "@/lib/googleDrive";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ fileId: string }>;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  baseDelayMs = 500
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt === retries - 1) break;
      const delay = baseDelayMs * 2 ** attempt;
      console.warn(`[Drive Proxy] Attempt ${attempt + 1} failed, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { fileId } = await params;

  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return new NextResponse("Invalid fileId", { status: 400 });
  }

  try {
    const accessToken = await getDriveAccessToken();
    const rangeHeader = req.headers.get("range") ?? "bytes=0-65535";

    const driveRes = await fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Range: rangeHeader,
        },
        signal: AbortSignal.timeout(30_000),
      }
    );

    // Token expired: clear the cache so the next request gets a fresh one
    if (driveRes.status === 401) {
      invalidateDriveTokenCache();
      return new NextResponse("Drive token expired, please retry", { status: 502 });
    }

    if (!driveRes.ok && driveRes.status !== 206) {
      return new NextResponse("File not found or access denied", {
        status: driveRes.status,
      });
    }

    const headers = new Headers();
    const forward = ["content-type", "content-length", "content-range", "accept-ranges"] as const;
    for (const key of forward) {
      const value = driveRes.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set("cache-control", "private, max-age=300");

    return new NextResponse(driveRes.body, { status: driveRes.status, headers });
  } catch (error) {
    logger.error({ err: error }, "[Drive Proxy] Error:");
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}