import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import prisma from "@/lib/prisma";
import { upsertGHLContact, searchContact, getLocationId } from "@/lib/ghl";
import { sendLeadMagnetEmail } from "@/services/emails/lead-magnet";
import { cookies } from "next/headers";
import { LEAD_EMAIL_COOKIE, leadCookieOptions } from "@/lib/lead-cookie";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      name, 
      email, 
      type = "ASSET_DOWNLOAD", // "ASSET_DOWNLOAD" | "LESSON_VIEW"
      consent, 
      
      // Fields for ASSET_DOWNLOAD
      mediaId, 
      fileName,
      
      // Fields for LESSON_VIEW
      lessonId,
      lessonTitle,
      courseName,
      moduleName,

      // Tracking
      utmSource, 
      utmMedium, 
      utmCampaign, 
      utmContent 
    } = body;

    // 1. Basic validation (manual form entry requires consent; cookie tracking may omit consent and name)
    const isCookieTracking = body.isCookieTracking === true;

    // Email is always required
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.warn(`[API /download-contact] Invalid/Missing email: ${email}`);
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    if (!isCookieTracking) {
      if (!name?.trim()) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      if (!consent && type === "ASSET_DOWNLOAD") {
        return NextResponse.json({ error: "Marketing consent is legally required" }, { status: 400 });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const displayName = name?.trim() || "User";

    // 2. Find or create the Contact (lead)
    const leadAttribution =
      utmSource || utmMedium || utmCampaign || utmContent
        ? JSON.stringify({
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            utm_content: utmContent,
          })
        : null;
    const now = new Date();
    const contact = await prisma.contact.upsert({
      where: { email: normalizedEmail },
      // Preserve first-touch attribution + pipeline status on update.
      update: {
        ...(isCookieTracking ? {} : { name: displayName }),
        source: "asset_download",
        lastActivityAt: now,
      },
      create: {
        name: displayName,
        email: normalizedEmail,
        status: "NEW",
        source: "asset_download",
        attribution: leadAttribution,
        lastActivityAt: now,
      },
    });

    // 3. Handle by type
    let eventToken: string | null = null;
    let eventExpiresAt: Date | null = null;
    let eventMetadata: Record<string, string> = {};
    let ghlTag = "";

    if (type === "ASSET_DOWNLOAD" && mediaId) {
      const media = await prisma.media.findUnique({
        where: { id: mediaId, downloadable: true },
      });

      if (!media) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      eventToken = uuidv4();
      eventExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); 
      eventMetadata = { mediaId, fileName: media.name };
      
      const safeSlug = media.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      ghlTag = `lead-magnet:${safeSlug || media.id}`;

      // Email is sent only for assets.
      // Sent even for silent cookie tracking, so the download flow stays the same.
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const downloadUrl = `${baseUrl}/api/download/${media.id}?token=${eventToken}`;
      await sendLeadMagnetEmail(normalizedEmail, displayName, media.name, downloadUrl);
      logger.info(`[API /download-contact] Email successfully sent to ${normalizedEmail}`);

    } else if (type === "LESSON_VIEW" && lessonId) {
      eventMetadata = { 
        lessonId, 
        lessonTitle: lessonTitle || "Unknown Lesson",
        courseName: courseName || "Unknown Course",
        moduleName: moduleName || "Unknown Module"
      };
      const safeSlug = (lessonTitle || lessonId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      ghlTag = `page-view:${safeSlug}`;
    }

    // 4. Create the Event
    await prisma.contactEvent.create({
      data: {
        contactId: contact.id,
        type,
        metadata: JSON.stringify(eventMetadata),
        token: eventToken,
        expiresAt: eventExpiresAt,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
      },
    });

    // 5. GHL Integration
    try {
      if (ghlTag && process.env.GHL_LOCATION_ID) { // GHL configured
        const existingContact = await searchContact(`email=${encodeURIComponent(normalizedEmail)}`);
        const existingTags = existingContact?.tags || [];
        const mergedTags = Array.from(new Set([...existingTags, ghlTag]));

        const customFields = [];
        if (utmSource && process.env.GHL_UTM_SOURCE_ID) customFields.push({ id: process.env.GHL_UTM_SOURCE_ID, value: utmSource });
        if (utmMedium && process.env.GHL_UTM_MEDIUM_ID) customFields.push({ id: process.env.GHL_UTM_MEDIUM_ID, value: utmMedium });
        if (utmCampaign && process.env.GHL_UTM_CAMPAIGN_ID) customFields.push({ id: process.env.GHL_UTM_CAMPAIGN_ID, value: utmCampaign });
        if (utmContent && process.env.GHL_UTM_CONTENT_ID) customFields.push({ id: process.env.GHL_UTM_CONTENT_ID, value: utmContent });

        await upsertGHLContact({
          locationId: getLocationId(),
          name: displayName,
          email: normalizedEmail,
          tags: mergedTags,
          ...(customFields.length > 0 && { customFields }),
        });
        logger.info(`[API /download-contact] GHL contact synced for ${normalizedEmail} with tag: ${ghlTag}`);
      }
    } catch (ghlError) {
      logger.error({ err: ghlError }, "[API /download-contact] GHL Integration Failed:");
    }

    // 6. Set the cookie (manual entry only) to remember the user for 60 days
    if (!isCookieTracking) {
      const cookieStore = await cookies();
      cookieStore.set(LEAD_EMAIL_COOKIE, normalizedEmail, leadCookieOptions);
    }

    return NextResponse.json({ success: true, message: type === "ASSET_DOWNLOAD" ? "Link sent to email" : "Access granted" });
  } catch (error) {
    logger.error({ err: error }, "[API /download-contact] Unhandled server error:");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
