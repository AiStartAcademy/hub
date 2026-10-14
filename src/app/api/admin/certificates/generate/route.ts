// src/app/api/admin/certificates/generate/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateCertificateId } from "@/lib/certificates";
import { uploadToGCS, bucket } from "@/lib/gcs";
import { renderCertificateFromHtml } from "@/lib/pdfGenerator";
import { fillCertificateBrandPlaceholders } from "@/lib/certificateBrandPlaceholders";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { logger } from "@/lib/logger";

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

    // 1. Skip an existing certificate so retries remain idempotent.
    const existing = await prisma.certificate.findUnique({
      where: { userId_cohortId: { userId, cohortId } },
    });

    if (existing) {
      return NextResponse.json({ 
        message: "Already exists, skipping", 
        certificate: existing,
        skipped: true 
      });
    }

    // 2. Fetch User, Cohort, and Template config
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const cohort = await prisma.cohort.findUnique({ where: { id: cohortId } });
    const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId } });

    if (!user || !cohort || !template) {
      return NextResponse.json({ error: "User, Cohort, or Template not found" }, { status: 404 });
    }

    // 3. Load the HTML template from GCS. template.layout stores its file name.
    const templateHtmlPath = `certificate-templates/${template.layout}`;
    let rawHtml = "";
    
    try {
      logger.info(`[CERT] Downloading HTML template from GCS: ${templateHtmlPath}`);
      const file = bucket.file(templateHtmlPath);
      const [buffer] = await file.download();
      rawHtml = buffer.toString("utf-8");
    } catch (gcsError) {
      logger.error({ err: gcsError },"[CERT] Failed to load HTML template from GCS:" );
      return NextResponse.json({ error: "HTML Template not found in GCS" }, { status: 500 });
    }

    // 4. Inject certificate data.
    const certId = generateCertificateId();
    const cohortTitle = cohort.title;
    const studentName = user.name || user.email || "Student";
    
    // Keep every displayed date in the same format.
    const formatDate = (dateValue: string | Date) => 
      new Date(dateValue).toLocaleDateString("en-US", { 
        month: "short", day: "numeric", year: "numeric" 
      });

    // Use the cohort date range when available, otherwise today's date.
    let dateFormatted: string;
    if (cohort.startDate && cohort.endDate) {
      dateFormatted = `${formatDate(cohort.startDate)} - ${formatDate(cohort.endDate)}`;
    } else {
      dateFormatted = formatDate(new Date());
    }


    // Replace the template's student and certificate placeholders.
    const processedHtml = fillCertificateBrandPlaceholders(rawHtml)
      .replace(/{{STUDENT_NAME}}/g, studentName)
      .replace(/{{COHORT_NAME}}/g, cohortTitle)
      .replace(/{{DATE}}/g, dateFormatted)
      .replace(/{{CERT_ID}}/g, certId);

    // 5. Render PDF and PNG through Puppeteer.
    logger.info(`[CERT] Rendering via Puppeteer for ${certId}`);
    const { pdfBuffer, pngBuffer } = await renderCertificateFromHtml(processedHtml);

    // 6. Store the rendered files in GCS.
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

    // 7. Save the certificate record.
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

    return NextResponse.json({ message: "Generated successfully", certificate, skipped: false });
  } catch (error) {
    logger.error({ err: error },"[CERTIFICATES_GENERATE_POST_ERROR]");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
