import { NextResponse } from "next/server";
import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasAnyRole } from "@/lib/roles";
import { sendMail, escapeHtml } from "@/lib/mail";
import { logger } from "@/lib/logger";
import { syncVenueEventToGcal } from "@/lib/googleCalendar";
import {
  serializeAgenda,
  serializeFaq,
  serializeGallery,
  serializeHosts,
  serializePricingTiers,
  normalizeVideoUrl,
} from "@/lib/venueEventContent";
import { VENUE_EVENT_TYPE_SET } from "@/lib/venueEventTypeLabels";

export const dynamic = "force-dynamic";

const STATUS_VALUES = new Set(["PENDING", "APPROVED", "DECLINED", "CANCELLED"]);
const DEAL_TYPE_VALUES = new Set([
  "PAID_RENTAL",
  "BARTER",
  "REVENUE_SHARE",
  "FREE_PROMO",
  "INTERNAL",
]);
const ALLOWED_KEYS = new Set([
  "status",
  "title",
  "description",
  "cover",
  "subtitle",
  "videoUrl",
  "priceNote",
  "date",
  "endDate",
  "startTime",
  "endTime",
  "gallery",
  "agenda",
  "hosts",
  "pricingTiers",
  "faq",
  "type",
  "organizerName",
  "orgName",
  "isOnline",
  "adminNote",
  "dealType",
  "dealNote",
  "quoteAmountCents",
  "quoteNote",
  "ticketPriceCents",
  "ticketPaymentLink",
  "capacity",
  "externalRegistrationUrl",
  "sendDeclineEmail",
  "resyncGcal",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASE_EVENT_URL = `${brand.urls.hub}/events`;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RequestBody = Record<string, unknown>;

type VenueEventUpdateData = {
  status?: string;
  title?: string;
  description?: string | null;
  cover?: string | null;
  subtitle?: string | null;
  videoUrl?: string | null;
  priceNote?: string | null;
  date?: Date;
  endDate?: Date | null;
  startTime?: string;
  endTime?: string;
  gallery?: string | null;
  agenda?: string | null;
  hosts?: string | null;
  pricingTiers?: string | null;
  faq?: string | null;
  type?: string;
  organizerName?: string;
  orgName?: string | null;
  isOnline?: boolean;
  adminNote?: string | null;
  dealType?: string; // non-nullable column with a default — clearing it is not a valid edit
  dealNote?: string | null;
  quoteAmountCents?: number | null;
  quoteNote?: string | null;
  ticketPriceCents?: number | null;
  ticketPaymentLink?: string | null;
  capacity?: number | null;
  externalRegistrationUrl?: string | null;
};

type SyncResult = {
  outcome: string;
  eventId?: string | null;
  error?: string | null;
};

function badField(field: string) {
  return NextResponse.json({ error: `Invalid field: ${field}` }, { status: 400 });
}

function readBodyValue(body: RequestBody, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key) ? body[key] : undefined;
}

function parseRequiredString(value: unknown, field: string) {
  if (typeof value !== "string") {
    return { error: badField(field) } as const;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { error: badField(field) } as const;
  }

  return { value: trimmed } as const;
}

function parseNullableString(value: unknown, field: string) {
  if (value === null) {
    return { value: null } as const;
  }
  if (typeof value !== "string") {
    return { error: badField(field) } as const;
  }

  const trimmed = value.trim();
  return { value: trimmed || null } as const;
}

function parseNonNegativeInteger(value: unknown, field: string) {
  if (value === null) {
    return { value: null } as const;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { error: badField(field) } as const;
  }
  return { value } as const;
}

function parsePositiveIntegerOrNull(value: unknown, field: string) {
  if (value === null) {
    return { value: null } as const;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return { error: badField(field) } as const;
  }
  return { value } as const;
}

function parseBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    return { error: badField(field) } as const;
  }
  return { value } as const;
}

function parseDateString(value: unknown, field: string) {
  if (typeof value !== "string") {
    return { error: badField(field) } as const;
  }

  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) {
    return { error: badField(field) } as const;
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    return { error: badField(field) } as const;
  }

  return { value: date } as const;
}

function parseNullableDateString(value: unknown, field: string) {
  if (value === null) {
    return { value: null } as const;
  }
  return parseDateString(value, field);
}

function parseVideoUrl(value: unknown, field: string) {
  if (value !== null && typeof value !== "string") {
    return { error: badField(field) } as const;
  }
  try {
    return { value: normalizeVideoUrl(value) } as const;
  } catch {
    return { error: badField(field) } as const;
  }
}

function parseJsonContent(
  value: unknown,
  field: string,
  serialize: (value: unknown) => string | null
) {
  if (value !== null && !Array.isArray(value) && typeof value !== "string") {
    return { error: badField(field) } as const;
  }
  return { value: serialize(value) } as const;
}

function serializeRecordDates(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ])
  );
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const rawBody = (await req.json().catch(() => null)) as RequestBody | null;
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    for (const key of Object.keys(rawBody)) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json({ error: `Unknown field: ${key}` }, { status: 400 });
      }
    }

    const existing = await prisma.venueEvent.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const previousStatus = existing.status;
    const updateData: VenueEventUpdateData = {};
    const nextState = {
      title: existing.title,
      date: existing.date,
      startTime: existing.startTime,
      endTime: existing.endTime,
      status: existing.status,
    };

    const statusValue = readBodyValue(rawBody, "status");
    if (statusValue !== undefined) {
      if (typeof statusValue !== "string" || !STATUS_VALUES.has(statusValue)) {
        return badField("status");
      }
      updateData.status = statusValue;
      nextState.status = statusValue;
    }

    const titleValue = readBodyValue(rawBody, "title");
    if (titleValue !== undefined) {
      const parsed = parseRequiredString(titleValue, "title");
      if ("error" in parsed) return parsed.error;
      updateData.title = parsed.value;
      nextState.title = parsed.value;
    }

    const descriptionValue = readBodyValue(rawBody, "description");
    if (descriptionValue !== undefined) {
      const parsed = parseNullableString(descriptionValue, "description");
      if ("error" in parsed) return parsed.error;
      updateData.description = parsed.value;
    }

    const coverValue = readBodyValue(rawBody, "cover");
    if (coverValue !== undefined) {
      const parsed = parseNullableString(coverValue, "cover");
      if ("error" in parsed) return parsed.error;
      updateData.cover = parsed.value;
    }

    const subtitleValue = readBodyValue(rawBody, "subtitle");
    if (subtitleValue !== undefined) {
      const parsed = parseNullableString(subtitleValue, "subtitle");
      if ("error" in parsed) return parsed.error;
      updateData.subtitle = parsed.value;
    }

    const videoUrlValue = readBodyValue(rawBody, "videoUrl");
    if (videoUrlValue !== undefined) {
      // Only an embeddable YouTube URL is storable — see normalizeVideoUrl.
      const parsed = parseVideoUrl(videoUrlValue, "videoUrl");
      if ("error" in parsed) return parsed.error;
      updateData.videoUrl = parsed.value;
    }

    const priceNoteValue = readBodyValue(rawBody, "priceNote");
    if (priceNoteValue !== undefined) {
      const parsed = parseNullableString(priceNoteValue, "priceNote");
      if ("error" in parsed) return parsed.error;
      updateData.priceNote = parsed.value;
    }

    const dateValue = readBodyValue(rawBody, "date");
    if (dateValue !== undefined) {
      const parsed = parseDateString(dateValue, "date");
      if ("error" in parsed) return parsed.error;
      updateData.date = parsed.value;
      nextState.date = parsed.value;
    }

    const endDateValue = readBodyValue(rawBody, "endDate");
    if (endDateValue !== undefined) {
      const parsed = parseNullableDateString(endDateValue, "endDate");
      if ("error" in parsed) return parsed.error;
      updateData.endDate = parsed.value;
    }

    const startTimeValue = readBodyValue(rawBody, "startTime");
    if (startTimeValue !== undefined) {
      const parsed = parseRequiredString(startTimeValue, "startTime");
      if ("error" in parsed) return parsed.error;
      updateData.startTime = parsed.value;
      nextState.startTime = parsed.value;
    }

    const endTimeValue = readBodyValue(rawBody, "endTime");
    if (endTimeValue !== undefined) {
      const parsed = parseRequiredString(endTimeValue, "endTime");
      if ("error" in parsed) return parsed.error;
      updateData.endTime = parsed.value;
      nextState.endTime = parsed.value;
    }

    const galleryValue = readBodyValue(rawBody, "gallery");
    if (galleryValue !== undefined) {
      const parsed = parseJsonContent(galleryValue, "gallery", serializeGallery);
      if ("error" in parsed) return parsed.error;
      updateData.gallery = parsed.value;
    }

    const agendaValue = readBodyValue(rawBody, "agenda");
    if (agendaValue !== undefined) {
      const parsed = parseJsonContent(agendaValue, "agenda", serializeAgenda);
      if ("error" in parsed) return parsed.error;
      updateData.agenda = parsed.value;
    }

    const hostsValue = readBodyValue(rawBody, "hosts");
    if (hostsValue !== undefined) {
      const parsed = parseJsonContent(hostsValue, "hosts", serializeHosts);
      if ("error" in parsed) return parsed.error;
      updateData.hosts = parsed.value;
    }

    const pricingTiersValue = readBodyValue(rawBody, "pricingTiers");
    if (pricingTiersValue !== undefined) {
      const parsed = parseJsonContent(
        pricingTiersValue,
        "pricingTiers",
        serializePricingTiers
      );
      if ("error" in parsed) return parsed.error;
      updateData.pricingTiers = parsed.value;
    }

    const faqValue = readBodyValue(rawBody, "faq");
    if (faqValue !== undefined) {
      const parsed = parseJsonContent(faqValue, "faq", serializeFaq);
      if ("error" in parsed) return parsed.error;
      updateData.faq = parsed.value;
    }

    const typeValue = readBodyValue(rawBody, "type");
    if (typeValue !== undefined) {
      if (typeof typeValue !== "string" || !VENUE_EVENT_TYPE_SET.has(typeValue)) {
        return badField("type");
      }
      updateData.type = typeValue;
    }

    const organizerNameValue = readBodyValue(rawBody, "organizerName");
    if (organizerNameValue !== undefined) {
      const parsed = parseRequiredString(organizerNameValue, "organizerName");
      if ("error" in parsed) return parsed.error;
      updateData.organizerName = parsed.value;
    }

    const orgNameValue = readBodyValue(rawBody, "orgName");
    if (orgNameValue !== undefined) {
      const parsed = parseNullableString(orgNameValue, "orgName");
      if ("error" in parsed) return parsed.error;
      updateData.orgName = parsed.value;
    }

    const isOnlineValue = readBodyValue(rawBody, "isOnline");
    if (isOnlineValue !== undefined) {
      const parsed = parseBoolean(isOnlineValue, "isOnline");
      if ("error" in parsed) return parsed.error;
      updateData.isOnline = parsed.value;
    }

    const adminNoteValue = readBodyValue(rawBody, "adminNote");
    if (adminNoteValue !== undefined) {
      const parsed = parseNullableString(adminNoteValue, "adminNote");
      if ("error" in parsed) return parsed.error;
      updateData.adminNote = parsed.value;
    }

    const dealTypeValue = readBodyValue(rawBody, "dealType");
    if (dealTypeValue !== undefined) {
      if (typeof dealTypeValue !== "string" || !DEAL_TYPE_VALUES.has(dealTypeValue)) {
        return badField("dealType");
      }
      updateData.dealType = dealTypeValue;
    }

    const dealNoteValue = readBodyValue(rawBody, "dealNote");
    if (dealNoteValue !== undefined) {
      const parsed = parseNullableString(dealNoteValue, "dealNote");
      if ("error" in parsed) return parsed.error;
      updateData.dealNote = parsed.value;
    }

    const quoteAmountValue = readBodyValue(rawBody, "quoteAmountCents");
    if (quoteAmountValue !== undefined) {
      const parsed = parseNonNegativeInteger(quoteAmountValue, "quoteAmountCents");
      if ("error" in parsed) return parsed.error;
      updateData.quoteAmountCents = parsed.value;
    }

    const quoteNoteValue = readBodyValue(rawBody, "quoteNote");
    if (quoteNoteValue !== undefined) {
      const parsed = parseNullableString(quoteNoteValue, "quoteNote");
      if ("error" in parsed) return parsed.error;
      updateData.quoteNote = parsed.value;
    }

    const ticketPriceValue = readBodyValue(rawBody, "ticketPriceCents");
    if (ticketPriceValue !== undefined) {
      const parsed = parseNonNegativeInteger(ticketPriceValue, "ticketPriceCents");
      if ("error" in parsed) return parsed.error;
      updateData.ticketPriceCents = parsed.value;
    }

    const ticketPaymentLinkValue = readBodyValue(rawBody, "ticketPaymentLink");
    if (ticketPaymentLinkValue !== undefined) {
      const parsed = parseNullableString(ticketPaymentLinkValue, "ticketPaymentLink");
      if ("error" in parsed) return parsed.error;
      updateData.ticketPaymentLink = parsed.value;
    }

    const capacityValue = readBodyValue(rawBody, "capacity");
    if (capacityValue !== undefined) {
      const parsed = parsePositiveIntegerOrNull(capacityValue, "capacity");
      if ("error" in parsed) return parsed.error;
      updateData.capacity = parsed.value;
    }

    const externalRegistrationUrlValue = readBodyValue(rawBody, "externalRegistrationUrl");
    if (externalRegistrationUrlValue !== undefined) {
      const parsed = parseNullableString(
        externalRegistrationUrlValue,
        "externalRegistrationUrl"
      );
      if ("error" in parsed) return parsed.error;
      updateData.externalRegistrationUrl = parsed.value;
    }

    let sendDeclineEmail = false;
    const sendDeclineEmailValue = readBodyValue(rawBody, "sendDeclineEmail");
    if (sendDeclineEmailValue !== undefined) {
      const parsed = parseBoolean(sendDeclineEmailValue, "sendDeclineEmail");
      if ("error" in parsed) return parsed.error;
      sendDeclineEmail = parsed.value;
    }

    let resyncGcal = false;
    const resyncGcalValue = readBodyValue(rawBody, "resyncGcal");
    if (resyncGcalValue !== undefined) {
      const parsed = parseBoolean(resyncGcalValue, "resyncGcal");
      if ("error" in parsed) return parsed.error;
      resyncGcal = parsed.value;
    }

    const updated = await prisma.venueEvent.update({
      where: { id },
      data: updateData,
    });

    if (previousStatus !== updated.status && updated.status === "APPROVED") {
      try {
        await sendMail({
          to: updated.contactEmail,
          subject: `Your event is confirmed: ${updated.title}`,
          html: `<p>Your event has been confirmed.</p>
<p><strong>Title:</strong> ${escapeHtml(updated.title)}</p>
<p><strong>Date:</strong> ${escapeHtml(updated.date.toISOString().slice(0, 10))}</p>
<p><strong>Time:</strong> ${escapeHtml(updated.startTime)} - ${escapeHtml(updated.endTime)}</p>
<p><strong>Event page:</strong> <a href="${escapeHtml(
  `${BASE_EVENT_URL}/${updated.slug}`
)}">${escapeHtml(`${BASE_EVENT_URL}/${updated.slug}`)}</a></p>`,
        });
      } catch (err) {
        logger.error({ err, venueEventId: updated.id }, "[admin venue-events] approval email failed");
      }
    }

    if (
      previousStatus !== updated.status &&
      updated.status === "DECLINED" &&
      sendDeclineEmail
    ) {
      try {
        await sendMail({
          to: updated.contactEmail,
          subject: `Update on your event request: ${updated.title}`,
          html: `<p>Thank you for your event request.</p>
<p>We are not able to accommodate <strong>${escapeHtml(
  updated.title
)}</strong> on ${escapeHtml(updated.date.toISOString().slice(0, 10))} at this time.</p>`,
        });
      } catch (err) {
        logger.error({ err, venueEventId: updated.id }, "[admin venue-events] decline email failed");
      }
    }

    const shouldSyncGcal =
      previousStatus !== nextState.status ||
      existing.title !== nextState.title ||
      existing.startTime !== nextState.startTime ||
      existing.endTime !== nextState.endTime ||
      existing.date.getTime() !== nextState.date.getTime() ||
      resyncGcal;

    let gcal: SyncResult | null = null;
    if (shouldSyncGcal) {
      gcal = await syncVenueEventToGcal(updated.id);
      if (gcal.outcome === "failed") {
        logger.error(
          { venueEventId: updated.id, eventId: gcal.eventId, error: gcal.error },
          "[admin venue-events] gcal sync failed"
        );
      }
    }

    return NextResponse.json({
      event: serializeRecordDates(updated as unknown as Record<string, unknown>),
      gcal,
    });
  } catch (err) {
    logger.error({ err }, "[admin venue-events] patch failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
