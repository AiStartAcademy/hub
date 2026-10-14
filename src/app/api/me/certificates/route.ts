// src/app/api/me/certificates/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { generateSignedUrl } from "@/lib/gcs";
import { logger } from "@/lib/logger";

// Disable caching so the user always gets their current certificates
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      logger.info("[GET_ME_CERTIFICATES] No session or user ID found");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    logger.info(`[GET_ME_CERTIFICATES] Fetching certs for user: ${session.user.id}`);

    const certificates = await prisma.certificate.findMany({
      where: {
        userId: session.user.id,
        isRevoked: false,
      },
      include: {
        cohort: { select: { title: true } },
      },
      orderBy: { issuedAt: "desc" }
    });

    logger.info(`[GET_ME_CERTIFICATES] Found ${certificates.length} certificates in DB for this user.`);

    const signedCertificates = await Promise.all(certificates.map(async (cert) => {
      let pdfSigned = cert.pdfUrl;
      let pngSigned = cert.pngUrl;
      
      try {
        if (cert.pdfUrl && !cert.pdfUrl.startsWith("http")) {
          pdfSigned = await generateSignedUrl(cert.pdfUrl);
        }
        if (cert.pngUrl && !cert.pngUrl.startsWith("http")) {
          pngSigned = await generateSignedUrl(cert.pngUrl);
        }
      } catch (e) {
        logger.error({ err: e }, `[GET_ME_CERTIFICATES] Failed to sign URL for cert ${cert.id}:`);
      }

      return {
        ...cert,
        pdfUrl: pdfSigned,
        pngUrl: pngSigned,
      };
    }));

    return NextResponse.json({ certificates: signedCertificates });
  } catch (error) {
    logger.error({ err: error }, "[GET_ME_CERTIFICATES] Error:");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}