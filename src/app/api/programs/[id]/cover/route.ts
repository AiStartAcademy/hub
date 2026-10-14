// src/app/api/programs/[id]/cover/route.ts
import { NextRequest, NextResponse } from "next/server";
import { bucket } from "@/lib/gcs";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get program cover URL from database
    const program = await prisma.program.findUnique({
      where: { id },
      select: { cover: true },
    });

    if (!program?.cover) {
      return NextResponse.json({ error: "No cover found" }, { status: 404 });
    }
    logger.info( {data: program.cover}, "[cover] program.cover =");

    // Extract filename from cover URL (removes /api/media/ prefix)
    const prefix = "/api/media/";
    if (!program.cover.startsWith(prefix)) {
      return NextResponse.json({ error: "Invalid cover URL" }, { status: 400 });
    }
    const filename = program.cover.slice(prefix.length);

    // Fetch file from GCS
    const file = bucket.file(filename);
    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "application/octet-stream";
    const fileSize = parseInt(metadata.size as string, 10);

    const rangeHeader = req.headers.get("range");

    if (rangeHeader) {
      // Parse Range: bytes=start-end
      const [, rangeValue] = rangeHeader.split("=");
      const [startStr, endStr] = rangeValue.split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      const stream = file.createReadStream({ start, end });
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
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      });
    }

    // Full file stream
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
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err: any) {
    if (err?.code === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    logger.error("Cover fetch error:", err?.message);
    return NextResponse.json({ error: "Failed to fetch cover" }, { status: 500 });
  }
}
