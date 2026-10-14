// src/app/api/public/newsletter/subscribe/route.ts
//
// Public newsletter signup. Single opt-in with an explicit consent checkbox,
// matching every other capture surface in the hub (asset downloads, event
// registration). List hygiene rests on the one-click unsubscribe the drip
// engine appends to every send, not on a confirmation round-trip.
//
// Three rules this route exists to enforce, all of which are easy to break by
// "simplifying" the upsert below:
//   1. Consent is read from the request, never manufactured. This form carries
//      no CALL_CONSENT_DISCLOSURE, so it must not touch phone consent state.
//   2. `source` and `attribution` are FIRST-touch. A subscriber who arrived
//      months ago via the quiz keeps that origin; attribution reporting reads it.
//   3. A deliberate re-subscribe clears `unsubscribedAt`. Leaving it set would
//      accept the signup and then silently suppress every send.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  ATTRIBUTION_COOKIE,
  SEGMENT_COOKIE,
  parseAttributionCookie,
  parseSegmentCookie,
} from "@/lib/attribution";
import { autoLinkContact } from "@/lib/leads/linking";
import { sendNewsletterWelcomeEmail } from "@/services/emails/newsletter-welcome";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const NEWSLETTER_TAG = "newsletter";
const NEWSLETTER_SOURCE = "newsletter";
const EVENT_TYPE = "NEWSLETTER_SUBSCRIBE";
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
// Contact.name is non-nullable, and the name field here is optional. "Subscriber"
// keeps the leads table honest rather than inventing a name from the address.
const FALLBACK_NAME = "Subscriber";

type SubscribeRequestBody = {
  email?: unknown;
  name?: unknown;
  consent?: unknown;
};

type ParsedAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  raw: string | null;
};

function jsonError(message: string, status: number, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

function normalizeIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) return "unknown";
  return forwardedFor.split(",")[0]?.trim() || "unknown";
}

function normalizeBodyValue(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry: unknown): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function mergeTag(raw: string | null, tag: string): string {
  const tags = parseTags(raw);
  return JSON.stringify(tags.includes(tag) ? tags : [...tags, tag]);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// The attribution cookie is written by UtmCapture with snake_case UTM keys
// (src/lib/attribution.ts), while Contact.attribution is stored camelCase to
// match what the leads admin reads. Normalize once, here.
function parseAttributionValue(raw: string | undefined): ParsedAttribution {
  let parsed: Record<string, unknown> | null = null;

  try {
    const cookieValue = parseAttributionCookie(raw ?? "");
    parsed =
      cookieValue !== null && typeof cookieValue === "object"
        ? (cookieValue as Record<string, unknown>)
        : null;
  } catch {
    parsed = null;
  }

  const read = (snake: string, camel: string): string | null =>
    parsed ? stringOrNull(parsed[snake]) ?? stringOrNull(parsed[camel]) : null;

  return {
    utmSource: read("utm_source", "utmSource"),
    utmMedium: read("utm_medium", "utmMedium"),
    utmCampaign: read("utm_campaign", "utmCampaign"),
    utmContent: read("utm_content", "utmContent"),
    raw: raw ?? null,
  };
}

function parseSegmentValue(raw: string | undefined): string | null {
  try {
    return parseSegmentCookie(raw ?? "") ?? (raw ?? null);
  } catch {
    return raw ?? null;
  }
}

function buildCreateAttribution(
  attribution: ParsedAttribution,
  segment: string | null,
): string | null {
  const payload: Record<string, unknown> = {};

  if (attribution.raw) payload.cookie = attribution.raw;
  if (attribution.utmSource) payload.utmSource = attribution.utmSource;
  if (attribution.utmMedium) payload.utmMedium = attribution.utmMedium;
  if (attribution.utmCampaign) payload.utmCampaign = attribution.utmCampaign;
  if (attribution.utmContent) payload.utmContent = attribution.utmContent;
  if (segment) payload.segment = segment;

  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}

export async function POST(req: Request): Promise<Response> {
  const ip = normalizeIp(req);
  const rateLimit = checkRateLimit(
    `newsletter-subscribe:${ip}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );

  if (rateLimit.limited) {
    return jsonError("Too many signup attempts. Please try again later.", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  let body: SubscribeRequestBody;
  try {
    body = (await req.json()) as SubscribeRequestBody;
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  const email = normalizeBodyValue(body.email, MAX_EMAIL_LENGTH).toLowerCase();
  const name = normalizeBodyValue(body.name, MAX_NAME_LENGTH) || null;

  if (!EMAIL_RE.test(email)) {
    return jsonError("A valid email is required.", 400);
  }

  if (body.consent !== true) {
    return jsonError("Marketing consent is legally required.", 400);
  }

  try {
    const cookieStore = await cookies();
    const attribution = parseAttributionValue(cookieStore.get(ATTRIBUTION_COOKIE)?.value);
    const segment = parseSegmentValue(cookieStore.get(SEGMENT_COOKIE)?.value);
    const now = new Date();

    const existingContact = await prisma.contact.findUnique({
      where: { email },
      select: { id: true, name: true, tags: true, unsubscribedAt: true },
    });

    const contact = existingContact
      ? await prisma.contact.update({
          where: { email },
          data: {
            // Only fill a missing name — never overwrite what staff or an
            // earlier, richer capture already recorded.
            ...(name && (!existingContact.name || existingContact.name === FALLBACK_NAME)
              ? { name }
              : {}),
            tags: mergeTag(existingContact.tags, NEWSLETTER_TAG),
            // Re-subscribing is fresh consent; clear a prior opt-out.
            ...(existingContact.unsubscribedAt ? { unsubscribedAt: null } : {}),
            lastActivityAt: now,
            // Deliberately absent: source, attribution (first-touch), status,
            // phone, phoneConsentAt (no consent disclosure on this form).
          },
          select: { id: true },
        })
      : await prisma.contact.create({
          data: {
            email,
            name: name ?? FALLBACK_NAME,
            source: NEWSLETTER_SOURCE,
            status: "NEW",
            tags: JSON.stringify([NEWSLETTER_TAG]),
            attribution: buildCreateAttribution(attribution, segment),
            lastActivityAt: now,
          },
          select: { id: true },
        });

    await prisma.contactEvent.create({
      data: {
        contactId: contact.id,
        type: EVENT_TYPE,
        metadata: JSON.stringify({ surface: "newsletter" }),
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign,
        utmContent: attribution.utmContent,
      },
    });

    // Best-effort: a CRM match must never fail lead capture.
    void autoLinkContact(contact.id).catch((error: unknown) => {
      logger.error({ err: error, contactId: contact.id }, "[newsletter] contact auto-link failed");
    });

    try {
      await sendNewsletterWelcomeEmail({ to: email, name });
    } catch (error: unknown) {
      logger.error({ err: error, email }, "[newsletter] welcome email failed (subscription saved)");
    }

    // Identical response whether or not the contact already existed — the
    // endpoint is public and must not disclose list membership.
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error: unknown) {
    logger.error({ err: error, email, ip }, "[newsletter] subscribe failed");
    return jsonError("Something went wrong. Please try again later.", 500);
  }
}
