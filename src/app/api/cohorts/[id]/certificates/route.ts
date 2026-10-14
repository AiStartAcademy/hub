import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { generateSignedUrl } from "@/lib/gcs"; 
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const userId = session.user.id;
    const canManage = hasAnyRole(session?.user, MANAGE_ROLES);

    let certificates;

    if (canManage) {
      certificates = await prisma.certificate.findMany({
        where: { cohortId: resolvedParams.id },
        include: {
          user: {
            select: { name: true, email: true, image: true },
          },
        },
        orderBy: { issuedAt: "desc" },
      });
    } else {
      certificates = await prisma.certificate.findMany({
        where: {
          cohortId: resolvedParams.id,
          userId: userId,
        },
        orderBy: { issuedAt: "desc" },
      });
    }

    // Swap the stored proxy URLs for temporary Google Cloud signed URLs
    const processedCertificates = await Promise.all(
      certificates.map(async (cert) => {
        return {
          ...cert,
          pdfUrlOriginal: cert.pdfUrl, // keep the original too
          pngUrlOriginal: cert.pngUrl,
          pdfUrl: cert.pdfUrl ? await generateSignedUrl(cert.pdfUrl) : null,
          pngUrl: cert.pngUrl ? await generateSignedUrl(cert.pngUrl) : null,
        };
      })
    );

    return NextResponse.json(processedCertificates);
  } catch (error) {
    logger.error({ err: error }, "[COHORT_CERTIFICATES_GET_ERROR]");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}