import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { bucket, getProxyUrl } from "@/lib/gcs";
import { google } from "googleapis";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { logger } from "@/lib/logger";

function normalizePrivateKey(key: string | undefined): string | undefined {
  if (!key) return key;
  // 1. Strip surrounding double or single quotes, if any
  let normalizedKey = key.replace(/^["']|["']$/g, "");
  // 2. Replace every literal \n with a real newline
  return normalizedKey.replace(/\\n/g, "\n");
}

function getDriveClient(accessToken?: string) {
  if (accessToken) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.drive({ version: "v3", auth: oauth2Client });
  }

  const authClient = new google.auth.JWT({
    email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    key: normalizePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth: authClient });
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const canManage = hasAnyRole(session?.user, MANAGE_ROLES);

    if (!canManage) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileId, fileName, mimeType, accessToken } = await req.json();

    if (!fileId) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }

    const drive = getDriveClient(accessToken);

    // Get a readable stream from Google Drive
    const driveResponse = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );

    const driveStream = driveResponse.data as NodeJS.ReadableStream;

    const safeName = (fileName || fileId).replace(/\s+/g, "-");
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const filename = `drive-${uniqueSuffix}-${safeName}`;
    const contentType = mimeType || "video/mp4";

    // Stream directly from Drive into GCS (resumable upload)
    await new Promise<void>((resolve, reject) => {
      const gcsFile = bucket.file(filename);
      const writeStream = gcsFile.createWriteStream({
        metadata: { contentType },
        resumable: true,
      });

      driveStream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);

      driveStream.pipe(writeStream);
    });

    const url = getProxyUrl(filename);

    let type = "document";
    if (contentType.startsWith("image/")) type = "image";
    else if (contentType.startsWith("video/")) type = "video";

    const media = await prisma.media.create({
      data: {
        name: fileName || filename,
        url,
        type,
        // size unknown when streaming — omit
      },
    });

    return NextResponse.json({ url, mediaId: media.id });
  } catch (error: any) {
    // Log full error for debugging
    logger.error( { data: JSON.stringify({
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
      data: error?.response?.data,
    }) }, "Drive import error:");
    
    const message = error?.errors?.[0]?.message || error?.message || "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
