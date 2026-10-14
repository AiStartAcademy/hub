// src/app/api/download/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { bucket } from "@/lib/gcs";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check if preview mode requested (inline instead of attachment)
  const isPreview = req.nextUrl.searchParams.get("preview") === "true";

  // Auth: session OR valid download token
  const session = await auth();
  let authorized = !!session?.user;

  if (!authorized) {
    const tokenParam = req.nextUrl.searchParams.get("token");
    if (tokenParam) {
      const contactEvent = await prisma.contactEvent.findFirst({
        where: {
          token: tokenParam,
          type: "ASSET_DOWNLOAD",
          expiresAt: { gt: new Date() },
        },
      });
      
      if (contactEvent) {
        try {
          // Verify that this token was generated specifically for this mediaId
          const metadata = JSON.parse(contactEvent.metadata);
          if (metadata.mediaId === id) {
            authorized = true;
          }
        } catch (e) {
          logger.error({ err: e }, "[Download API] Failed to parse ContactEvent metadata");
        }
      }
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const media = await prisma.media.findUnique({
    where: { id, downloadable: true },
  });

  if (!media) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Extract filename from proxy URL: /api/media/filename -> filename
  const filename = media.url.replace(/^\/api\/media\//, "");

  try {
    const file = bucket.file(filename);
    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "application/octet-stream";
    const fileSize = parseInt(metadata.size as string, 10);

    const stream = file.createReadStream();
    const reader = stream[Symbol.asyncIterator]();

    const webStream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel() {
        stream.destroy();
      },
    });

    const disposition = isPreview
      ? `inline; filename="${encodeURIComponent(media.name)}"`
      : `attachment; filename="${encodeURIComponent(media.name)}"`;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Content-Disposition": disposition,
        // Support range requests for PDF.js partial page loading
        "Accept-Ranges": "bytes",
        "Cache-Control": isPreview ? "private, max-age=300" : "private, no-cache",
      },
    });
  } catch (err: any) {
    if (err?.code === 404) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    logger.error("Download error:", err?.message);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}
