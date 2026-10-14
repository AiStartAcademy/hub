import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFromGCS } from "@/lib/gcs";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; certId: string }> }
) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const { id: cohortId, certId } = resolvedParams;

    const certificate = await prisma.certificate.findUnique({
      where: { id: certId },
    });

    if (!certificate || certificate.cohortId !== cohortId) {
      return NextResponse.json({ error: "Certificate not found" }, { status: 404 });
    }

    // Delete the files from Google Cloud Storage.
    // deleteFromGCS accepts a proxy URL and extracts the key itself
    if (certificate.pdfUrl) await deleteFromGCS(certificate.pdfUrl);
    if (certificate.pngUrl) await deleteFromGCS(certificate.pngUrl);

    // Delete from the DB
    await prisma.certificate.delete({
      where: { id: certId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "[CERTIFICATE_DELETE_ERROR]");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}