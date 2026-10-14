import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadToGCS } from "@/lib/gcs";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let templates = await prisma.certificateTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(templates);
  } catch (error) {
    logger.error({ err: error },"[CERTIFICATE_TEMPLATES_GET_ERROR]");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string | null;

    if (!file || !name) {
      return NextResponse.json({ error: "File and name are required" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".html")) {
      return NextResponse.json({ error: "Only HTML files are allowed" }, { status: 400 });
    }

    // Reject a duplicate template name (case-insensitive)
    const existing = await prisma.certificateTemplate.findFirst({
      where: {
        name: { equals: name },
      },
    });

    if (existing) {
      return NextResponse.json({ error: "A template with this exact name already exists." }, { status: 409 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Build a unique GCS object name for the upload
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${Date.now()}_${safeName}`;
    const objectKey = `certificate-templates/${fileName}`;

    await uploadToGCS(buffer, objectKey, "text/html");

    const template = await prisma.certificateTemplate.create({
      data: {
        name,
        layout: fileName,
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    logger.error({ err: error }, "[CERTIFICATE_TEMPLATES_POST_ERROR]",);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}