import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateCertificateId } from "@/lib/certificates";
import { PDFDocument } from "pdf-lib";
import { uploadToGCS } from "@/lib/gcs";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { logger } from "./logger";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!hasAnyRole(session?.user, MANAGE_ROLES)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, cohortId, templateId } = await req.json();

    if (!userId || !cohortId || !templateId) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    // 1. Check if certificate already exists
    const existing = await prisma.certificate.findUnique({
      where: {
        userId_cohortId: {
          userId,
          cohortId,
        },
      },
    });

    if (existing) {
      return NextResponse.json({ message: "Already exists", certificate: existing });
    }

    // 2. We need to verify that User and Cohort exist
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const cohort = await prisma.cohort.findUnique({ where: { id: cohortId } });
    const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId } });

    if (!user || !cohort || !template) {
      return NextResponse.json({ error: "User, Cohort, or Template not found" }, { status: 404 });
    }

    const certId = generateCertificateId();
    
    const cohortTitle = cohort.title;
    const studentName = user.name || user.email || "Student";
    const dateFormatted = cohort.endDate
        // cohort.endDate is a date-only value stored at UTC midnight — format it in UTC
        // or the certificate prints a day early on any host west of UTC.
        ? new Date(cohort.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
        : new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    
    // 3. Request PNG from our rendering endpoint
    logger.info(`[CERT] Generating PNG via @vercel/og for ${certId}`);
    
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const renderUrl = new URL(`/api/certificates/render`, baseUrl);
    renderUrl.searchParams.set("studentName", studentName);
    renderUrl.searchParams.set("cohortName", cohortTitle);
    renderUrl.searchParams.set("date", dateFormatted);
    renderUrl.searchParams.set("certId", certId);

    const pngResponse = await fetch(renderUrl.toString());
    if (!pngResponse.ok) {
        throw new Error("Failed to render ImageResponse PNG");
    }
    const pngArrayBuffer = await pngResponse.arrayBuffer();
    const pngBuffer = Buffer.from(pngArrayBuffer);

    // 4. Wrap the PNG in a PDF
    logger.info(`[CERT] Wrapping PNG into PDF for ${certId}`);
    const pdfDoc = await PDFDocument.create();
    
    const page = pdfDoc.addPage([1200, 1553]); 
    const pngImage = await pdfDoc.embedPng(pngBuffer);
    
    page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: 1200,
        height: 1553,
    });
    
    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    // 5. Upload directly to GCS via our lib function
    // format to lowercase and replace spaces/special chars with hyphens
    const safeCohortName = cohortTitle
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const gcsPathPng = `cohorts/${safeCohortName}/certificates/${certId}.png`;
    const gcsPathPdf = `cohorts/${safeCohortName}/certificates/${certId}.pdf`;

    logger.info(`[CERT] Uploading files to GCS at ${gcsPathPng}...`);
    
    const [pngProxyUrl, pdfProxyUrl] = await Promise.all([
      uploadToGCS(pngBuffer, gcsPathPng, "image/png"),
      uploadToGCS(pdfBuffer, gcsPathPdf, "application/pdf")
    ]);

    // 6. DB Save
    logger.info(`[CERT] DB Save...`);
    const certificate = await prisma.certificate.create({
      data: {
        id: certId,
        userId: userId,
        cohortId: cohortId,
        templateId: templateId,
        pdfUrl: pdfProxyUrl,
        pngUrl: pngProxyUrl,
      },
    });

    return NextResponse.json({ message: "Generated successfully", certificate });
  } catch (error) {
    logger.error({ err: error }, "[CERTIFICATES_GENERATE_POST_ERROR]");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}