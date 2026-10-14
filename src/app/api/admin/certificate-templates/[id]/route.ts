import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteFromGCS } from "@/lib/gcs";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: templateId } = await params;

    const template = await prisma.certificateTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      await deleteFromGCS(`certificate-templates/${template.layout}`);
    } catch (gcsError) {
      console.warn("[CERTIFICATE_TEMPLATE] GCS Delete failed, proceeding with DB delete.", gcsError);
    }

    await prisma.certificateTemplate.delete({
      where: { id: templateId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error },"[CERTIFICATE_TEMPLATES_DELETE_ERROR]");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}