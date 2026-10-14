// src/app/api/upload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  uploadToGCS,
  buildMediaKey,
  resolveMediaKey,
  buildMediaThumbnailKey,
} from "@/lib/gcs";
import { getProxyUrl } from "@/lib/mediaUtils";
import { generatePdfThumbnail } from "@/lib/pdf-thumbnail";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

type UploadResult = {
  name: string;
  url?: string;
  thumbnailUrl?: string | null;
  error?: string;
};

function detectType(file: File): string {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (
    file.type === "application/pdf" ||
    file.type.includes("presentation") ||
    file.name.endsWith(".pptx") ||
    file.name.endsWith(".pdf") ||
    file.name.endsWith(".key")
  ) {
    return "presentation";
  }
  return "document";
}

/**
 * Uploads a single file: resolves a deterministic collision-free key,
 * writes to GCS, generates a PDF thumbnail if applicable, creates a Media row.
 * Files in a batch are processed SEQUENTIALLY so that resolveMediaKey's GCS
 * existence check also disambiguates same-named files within one request.
 */
async function processFile(
  file: File,
  folderId: string | null,
  namespace: string | null,
  slug: string | null
): Promise<UploadResult> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Deterministic, predictable key: media/{namespace}/{slug}/{slugified-name}
  // Defaults to media/general/{YYYY-MM}/… when no namespace/slug is supplied.
  // Collisions resolve as -2, -3 … — never with random entropy.
  const baseKey = buildMediaKey(namespace, slug, file.name);
  const fileFilename = await resolveMediaKey(baseKey, async (candidate) => {
    const taken = await prisma.media.findFirst({
      where: { url: getProxyUrl(candidate) },
      select: { id: true },
    });
    return taken !== null;
  });

  const url = await uploadToGCS(buffer, fileFilename, file.type);

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  // Generate thumbnail for PDFs
  let thumbnailUrl: string | null = null;
  if (isPdf) {
    try {
      logger.info(`[upload] Generating thumbnail for PDF: ${file.name}`);
      const thumbnailBuffer = await generatePdfThumbnail(buffer);
      const thumbnailFilename = buildMediaThumbnailKey(fileFilename);
      thumbnailUrl = await uploadToGCS(
        thumbnailBuffer,
        thumbnailFilename,
        "image/png"
      );
      logger.info(`[upload] Thumbnail uploaded to ${thumbnailFilename}`);
    } catch (thumbErr: any) {
      logger.error(
        `[upload] Thumbnail generation failed for ${file.name}:`,
        thumbErr?.message || thumbErr
      );
    }
  }

  await prisma.media.create({
    data: {
      name: file.name,
      url,
      type: detectType(file),
      size: file.size,
      thumbnailUrl,
      folderId: folderId && folderId !== "null" ? folderId : null,
    },
  });

  return { name: file.name, url, thumbnailUrl };
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const canManage = hasAnyRole(session?.user, MANAGE_ROLES);

    if (!canManage) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const folderId = formData.get("folderId") as string | null;
    const namespace = formData.get("namespace") as string | null;
    const slug = formData.get("slug") as string | null;

    // Accept repeated "file" fields (canonical) and a "files" field (alias).
    // Single-file callers keep working unchanged.
    const files = [...formData.getAll("file"), ...formData.getAll("files")]
      .filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const results: UploadResult[] = [];
    for (const file of files) {
      try {
        results.push(await processFile(file, folderId, namespace, slug));
      } catch (err: any) {
        logger.error(`[upload] Failed for ${file.name}:`, err?.message || err);
        results.push({ name: file.name, error: err?.message || "Upload failed" });
      }
    }

    if (results.some((r) => r.url)) {
      revalidatePath("/media");
    }

    // Backward compat: single-file callers read data.url / data.thumbnailUrl.
    const firstOk = results.find((r) => r.url);

    // A single failed file behaves exactly as before: 500 with { error }.
    if (!firstOk && results.length === 1) {
      return NextResponse.json({ error: results[0].error }, { status: 500 });
    }

    return NextResponse.json({
      url: firstOk?.url,
      thumbnailUrl: firstOk?.thumbnailUrl ?? null,
      files: results,
    });
  } catch (error: any) {
    logger.error("Upload error:", error?.message || error);
    const message = error?.message || "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
