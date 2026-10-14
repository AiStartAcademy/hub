import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { sendMail, escapeHtml } from "@/lib/mail";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rateLimit";
import { WAIVER_VERSION } from "@/lib/waiver";
import { cookies } from "next/headers";
import {
  ATTRIBUTION_COOKIE,
  SEGMENT_COOKIE,
  parseAttributionCookie,
  parseSegmentCookie,
} from "@/lib/attribution";
import { fillPhoneIfEmpty, onboardingPhoneForStorage } from "@/lib/phone";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const REGISTRANT_TAG = "venue-event-registrant";

type RegisterRequestBody = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  waiverAccepted?: unknown;
};

type ParsedAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  raw: string | null;
};

type ParsedSegment = string | Record<string, unknown> | null;

type EventRecord = {
  id: string;
  slug: string;
  title: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  status: string; // SQLite stores the union as a plain String column: PENDING | APPROVED | DECLINED | CANCELLED
  capacity: number | null;
  isOnline: boolean;
  ticketPriceCents: number | null;
  ticketPaymentLink: string | null;
  externalRegistrationUrl: string | null;
};

type ExistingRegistrationRecord = {
  status: string; // CONFIRMED | PENDING_PAYMENT | CANCELLED (plain String column)
};

function jsonError(message: string, status: number, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

function normalizeIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return "unknown";
  }

  const firstIp = forwardedFor.split(",")[0]?.trim();
  return firstIp || "unknown";
}

function normalizeBodyValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPositiveNumber(value: number | null): value is number {
  return typeof value === "number" && value > 0;
}

function occupancyStatus(status: string): boolean {
  return status === "CONFIRMED" || status === "PENDING_PAYMENT";
}

function parseTags(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry: unknown): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function mergeTag(raw: string | null, tag: string): string {
  const tags = parseTags(raw);
  const nextTags = tags.includes(tag) ? tags : [...tags, tag];
  return JSON.stringify(nextTags);
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readAttributionField(source: Record<string, unknown> | null, key: string): string | null {
  if (!source) {
    return null;
  }

  return stringOrNull(source[key]);
}

function parseAttributionValue(raw: string | undefined): ParsedAttribution {
  let parsed: Record<string, unknown> | null = null;

  try {
    parsed = safeObject(parseAttributionCookie(raw ?? ""));
  } catch {
    parsed = null;
  }

  return {
    utmSource: readAttributionField(parsed, "utmSource"),
    utmMedium: readAttributionField(parsed, "utmMedium"),
    utmCampaign: readAttributionField(parsed, "utmCampaign"),
    utmContent: readAttributionField(parsed, "utmContent"),
    raw: raw ?? null,
  };
}

function parseSegmentValue(raw: string | undefined): ParsedSegment {
  let parsed: unknown;

  try {
    parsed = parseSegmentCookie(raw ?? "");
  } catch {
    return raw ?? null;
  }

  if (typeof parsed === "string") {
    return parsed;
  }

  if (parsed !== null && typeof parsed === "object") {
    return parsed as Record<string, unknown>;
  }

  return raw ?? null;
}

function buildCreateAttribution(attribution: ParsedAttribution, segment: ParsedSegment): string {
  const payload: Record<string, unknown> = {};

  if (attribution.raw) {
    payload.cookie = attribution.raw;
  }
  if (attribution.utmSource) {
    payload.utmSource = attribution.utmSource;
  }
  if (attribution.utmMedium) {
    payload.utmMedium = attribution.utmMedium;
  }
  if (attribution.utmCampaign) {
    payload.utmCampaign = attribution.utmCampaign;
  }
  if (attribution.utmContent) {
    payload.utmContent = attribution.utmContent;
  }
  if (segment) {
    payload.segment = segment;
  }

  return JSON.stringify(payload);
}

function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

async function sendConfirmationEmail(input: {
  email: string;
  name: string;
  event: EventRecord;
  registrationStatus: "CONFIRMED" | "PENDING_PAYMENT";
}): Promise<void> {
  const paymentLink = input.event.ticketPaymentLink ?? null;
  const safeName = escapeHtml(input.name);
  const safeTitle = escapeHtml(input.event.title);
  const safeDate = escapeHtml(formatEventDate(input.event.date));
  const safeStartTime = input.event.startTime ? escapeHtml(input.event.startTime) : null;
  const safeEndTime = input.event.endTime ? escapeHtml(input.event.endTime) : null;
  const safePaymentLink = paymentLink ? escapeHtml(paymentLink) : null;
  const timeRange =
    safeStartTime && safeEndTime
      ? `${safeStartTime} - ${safeEndTime}`
      : safeStartTime || safeEndTime || "Time to be announced";

  const paymentParagraph =
    input.registrationStatus === "PENDING_PAYMENT"
      ? safePaymentLink
        ? `<p>Your seat is held pending payment. Complete payment here: <a href="${safePaymentLink}">${safePaymentLink}</a>.</p>`
        : "<p>Your seat is held pending payment. The organizer will share the payment link separately.</p>"
      : "<p>Your registration is confirmed.</p>";

  await sendMail({
    to: input.email,
    subject: `Registration received: ${input.event.title}`,
    html: [
      `<p>Hi ${safeName},</p>`,
      `<p>Thanks for registering for ${safeTitle}.</p>`,
      `<p><strong>Date:</strong> ${safeDate}<br /><strong>Time:</strong> ${timeRange}</p>`,
      paymentParagraph,
    ].join(""),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const ip = normalizeIp(req);
  const userAgent = req.headers.get("user-agent");
  const rateLimit = checkRateLimit(`venue-event-register:${slug}:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

  if (rateLimit.limited) {
    return jsonError("Too many registration attempts. Please try again later.", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  let body: RegisterRequestBody;
  try {
    body = (await req.json()) as RegisterRequestBody;
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  const name = normalizeBodyValue(body.name);
  const email = normalizeBodyValue(body.email).toLowerCase();
  const phone = normalizeBodyValue(body.phone) || null;
  const waiverAccepted = body.waiverAccepted === true;

  if (!name) {
    return jsonError("Name is required.", 400);
  }

  if (!EMAIL_RE.test(email)) {
    return jsonError("A valid email is required.", 400);
  }

  try {
    const event = await prisma.venueEvent.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        date: true,
        startTime: true,
        endTime: true,
        status: true,
        capacity: true,
        isOnline: true,
        ticketPriceCents: true,
        ticketPaymentLink: true,
        externalRegistrationUrl: true,
      },
    });

    if (!event || event.status !== "APPROVED") {
      return jsonError("Event not found.", 404);
    }

    if (event.externalRegistrationUrl) {
      return jsonError(
        "Registration is handled on the organizer's own page for this event.",
        400,
      );
    }

    if (!event.isOnline && !waiverAccepted) {
      return jsonError("Please accept the visitor waiver to register.", 400);
    }

    const cookieStore = await cookies();
    const attribution = parseAttributionValue(cookieStore.get(ATTRIBUTION_COOKIE)?.value);
    const segment = parseSegmentValue(cookieStore.get(SEGMENT_COOKIE)?.value);
    const registrationStatus: "CONFIRMED" | "PENDING_PAYMENT" = isPositiveNumber(
      event.ticketPriceCents,
    )
      ? "PENDING_PAYMENT"
      : "CONFIRMED";

    const result = await prisma.$transaction(async (tx) => {
      const existingRegistration = await tx.venueEventRegistration.findUnique({
        where: {
          venueEventId_email: {
            venueEventId: event.id,
            email,
          },
        },
        select: {
          status: true,
        },
      });

      if (isPositiveNumber(event.capacity)) {
        const activeRegistrationCount = await tx.venueEventRegistration.count({
          where: {
            venueEventId: event.id,
            status: {
              in: ["CONFIRMED", "PENDING_PAYMENT"],
            },
          },
        });

        const existingOccupiesSeat = existingRegistration
          ? occupancyStatus(existingRegistration.status)
          : false;

        if (activeRegistrationCount >= event.capacity && !existingOccupiesSeat) {
          return { full: true as const };
        }
      }

      const existingContact = await tx.contact.findUnique({
        where: { email },
        select: {
          id: true,
          phone: true,
          tags: true,
        },
      });

      const mergedTags = mergeTag(existingContact?.tags ?? null, REGISTRANT_TAG);
      const contactPhone = onboardingPhoneForStorage(phone);
      const filledContactPhone = existingContact
        ? fillPhoneIfEmpty(existingContact.phone, contactPhone)
        : contactPhone;
      const now = new Date();
      const contact = existingContact
        ? await tx.contact.update({
            where: { email },
            data: {
              name,
              ...(filledContactPhone !== existingContact.phone
                ? { phone: filledContactPhone }
                : {}),
              // This form has no CALL_CONSENT_DISCLOSURE, so it must not
              // manufacture phone consent or alter opt-out / do-not-call state.
              tags: mergedTags,
              lastActivityAt: now,
            },
            select: {
              id: true,
              tags: true,
            },
          })
        : await tx.contact.create({
            data: {
              email,
              name,
              phone: contactPhone,
              // This form has no CALL_CONSENT_DISCLOSURE, so it must not
              // manufacture phone consent or alter opt-out / do-not-call state.
              source: `venue-event:${slug}`,
              status: "NEW",
              attribution: buildCreateAttribution(attribution, segment),
              tags: mergedTags,
              lastActivityAt: now,
            },
            select: {
              id: true,
              tags: true,
            },
          });

      await tx.contactEvent.create({
        data: {
          contactId: contact.id,
          type: "VENUE_EVENT_REGISTER",
          metadata: JSON.stringify({
            slug: event.slug,
            title: event.title,
            status: registrationStatus,
          }),
          utmSource: attribution.utmSource,
          utmMedium: attribution.utmMedium,
          utmCampaign: attribution.utmCampaign,
          utmContent: attribution.utmContent,
        },
      });

      await tx.venueEventRegistration.upsert({
        where: {
          venueEventId_email: {
            venueEventId: event.id,
            email,
          },
        },
        update: {
          contactId: contact.id,
          name,
          phone,
          status: registrationStatus,
          waiverAcceptedAt: event.isOnline ? null : now,
          waiverVersion: event.isOnline ? null : WAIVER_VERSION,
          ip,
          userAgent,
        },
        create: {
          venueEventId: event.id,
          contactId: contact.id,
          name,
          email,
          phone,
          status: registrationStatus,
          waiverAcceptedAt: event.isOnline ? null : now,
          waiverVersion: event.isOnline ? null : WAIVER_VERSION,
          ip,
          userAgent,
        },
      });

      return {
        full: false as const,
        paymentLink: event.ticketPaymentLink ?? null,
      };
    });

    if (result.full) {
      return jsonError("This event is full.", 409);
    }

    try {
      await sendConfirmationEmail({
        email,
        name,
        event,
        registrationStatus,
      });
    } catch (error: unknown) {
      logger.error({ err: error, slug, email }, "[venue-register] confirmation email failed (registration saved)");
    }

    return NextResponse.json(
      {
        ok: true,
        status: registrationStatus,
        paymentLink: result.paymentLink,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    logger.error({ err: error, slug, email, ip }, "[venue-register] registration failed");

    return jsonError("Something went wrong. Please try again later.", 500);
  }
}
