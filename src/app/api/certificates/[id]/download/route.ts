import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateSignedUrl } from "@/lib/gcs";

type DownloadFormat = "pdf" | "png";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isDownloadFormat(value: string | null): value is DownloadFormat {
  return value === "pdf" || value === "png";
}

function isValidSignedUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: RouteContext
): Promise<Response> {
  const format = new URL(request.url).searchParams.get("format");
  if (!isDownloadFormat(format)) {
    return NextResponse.json(
      { error: "Format must be pdf or png" },
      { status: 400 }
    );
  }

  const { id: rawId } = await params;
  const id = rawId.trim().toUpperCase();
  const certificate = await prisma.certificate.findUnique({
    where: { id },
    select: {
      id: true,
      pdfUrl: true,
      pngUrl: true,
      isRevoked: true,
    },
  });
  const objectUrl = format === "pdf" ? certificate?.pdfUrl : certificate?.pngUrl;

  if (!certificate || certificate.isRevoked || !objectUrl) {
    return NextResponse.json(
      { error: "Certificate download not found" },
      { status: 404 }
    );
  }

  let signedUrl: unknown;
  try {
    signedUrl = await generateSignedUrl(objectUrl);
  } catch (error: unknown) {
    throw new Error(
      `[CERTIFICATE_DOWNLOAD] Failed to sign ${format} for certificate ${id}`,
      { cause: error }
    );
  }

  if (!isValidSignedUrl(signedUrl)) {
    throw new Error(
      `[CERTIFICATE_DOWNLOAD] Invalid signed URL for ${format} certificate ${id}`
    );
  }

  return NextResponse.redirect(signedUrl, 302);
}
