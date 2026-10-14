import { NextRequest, NextResponse } from "next/server";
import { bucket } from "@/lib/gcs";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Public PDF preview endpoint (no auth required).
 * Serves PDF inline for PDF.js preview. Only works for files with downloadable: true.
 *
 * Security note: Since downloadable:true means the admin made the file publicly listed,
 * preview also serves it publicly. Anyone who knows the ID can access the full PDF.
 * If stricter control is needed, consider converting first page to PNG server-side.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Only serve preview for publicly available (downloadable) files
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
    const contentType = (metadata.contentType as string) || "application/pdf";
    const fileSize = parseInt(metadata.size as string, 10);

    // Only allow preview for actual PDF files
    if (!contentType.includes("pdf") && !media.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Not a PDF file" }, { status: 400 });
    }

    logger.info(`[pdf-preview] Serving preview for media ${id} (${media.name})`);

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

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        // Inline display for PDF.js (not attachment/download)
        "Content-Disposition": `inline; filename="${encodeURIComponent(media.name)}"`,
        // Support PDF.js range requests for partial page loading
        "Accept-Ranges": "bytes",
        // Public cache: preview is safe to cache browser-side
        "Cache-Control": "public, max-age=3600",
        // Allow embedding in PDF.js from any origin (if needed)
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    if (err?.code === 404) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    logger.error(`[pdf-preview] Error serving media ${id}:`, err?.message);
    return NextResponse.json({ error: "Failed to load preview" }, { status: 500 });
  }
}