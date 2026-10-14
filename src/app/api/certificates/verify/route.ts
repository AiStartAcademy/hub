// src/app/api/certificates/verify/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateSignedUrl } from "@/lib/gcs";
import { logger } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Certificate ID is required" }, { status: 400 });
    }
    
    id = id.trim().toUpperCase();

    const certificate = await prisma.certificate.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        cohort: { select: { title: true, startDate: true, endDate: true } }
      }
    });

    if (!certificate) {
      return NextResponse.json({ valid: false, error: "Certificate not found. Please check the ID and try again." });
    }

    if (certificate.isRevoked) {
      return NextResponse.json({ 
        valid: false, 
        error: "This certificate has been actively revoked.",
        certificate: {
          id: certificate.id,
          studentName: certificate.user.name,
          cohortName: certificate.cohort.title,
          issuedAt: certificate.issuedAt,
          cohortStartDate: certificate.cohort.startDate,
          cohortEndDate: certificate.cohort.endDate
        }
      });
    }

    let pdfUrl = certificate.pdfUrl;
    let pngUrl = certificate.pngUrl;

    try {
      if (pdfUrl && !pdfUrl.startsWith('http')) {
        pdfUrl = await generateSignedUrl(pdfUrl);
      }
      if (pngUrl && !pngUrl.startsWith('http')) {
        pngUrl = await generateSignedUrl(pngUrl);
      }
    } catch (err) {
      logger.error({ err: err }, `[VERIFY_CERTIFICATES] Failed to sign URLs for cert ${id}:`);
    }

    return NextResponse.json({
      valid: true,
      certificate: {
        id: certificate.id,
        pdfUrl,
        pngUrl,
        studentName: certificate.user.name,
        cohortName: certificate.cohort.title,
        issuedAt: certificate.issuedAt,
        cohortStartDate: certificate.cohort.startDate,
        cohortEndDate: certificate.cohort.endDate,
      }
    });
    
  } catch (error) {
    logger.error({ err: error }, "[VERIFY_CERTIFICATES] Internal Error:");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}