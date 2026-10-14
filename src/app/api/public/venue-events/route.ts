import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { escapeHtml, sendMail } from "@/lib/mail";
import {
  ATTRIBUTION_COOKIE,
  SEGMENT_COOKIE,
  parseAttributionCookie,
  parseSegmentCookie,
} from "@/lib/attribution";
import { hasSlugSafeChars, slugify } from "@/lib/slug";
import {
  parseProjectTimeToMinutes,
  projectTimeRangesOverlap,
} from "@/lib/calendarUtils";
import { syncVenueEventToGcal } from "@/lib/googleCalendar";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_COHORT_STATUSES = ["ENROLLMENT", "IN_PROGRESS", "COMPLETE"] as const;
const VENUE_EVENT_TYPES = [
  "NETWORKING",
  "HACKATHON",
  "WORKSHOP",
  "MEETUP",
  "INTERVIEW",
  "PODCAST",
  "PANEL",
  "DEMO_DAY",
  "KIDS_PROGRAM",
  "MOVIE_CLUB",
  "OTHER",
] as const;

type VenueEventType = (typeof VENUE_EVENT_TYPES)[number];

type Conflict = {
  label: string;
  startTime: string;
  endTime: string;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const trimmed = readString(value);
  return trimmed || undefined;
}

function readPositiveInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { value: undefined as number | undefined, invalid: false };
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return { value, invalid: false };
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return { value: parsed, invalid: false };
    }
  }
  return { value: undefined as number | undefined, invalid: true };
}

function parseUtcDate(dateString: string) {
  if (!DATE_RE.test(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== dateString) return null;
  return date;
}

function safeParseTags(tags: string | null) {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

async function createUniqueSlug(title: string) {
  const normalized = hasSlugSafeChars(title) ? slugify(title) : "";
  const root = normalized || "venue-event";

  for (let index = 0; index < 50; index += 1) {
    const slug = index === 0 ? root : `${root}-${index + 1}`;
    const existing = await prisma.venueEvent.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) return slug;
  }

  return `${root}-${Date.now()}`;
}

function sortConflicts(conflicts: Conflict[]) {
  return conflicts.sort(
    (a, b) =>
      parseProjectTimeToMinutes(a.startTime) - parseProjectTimeToMinutes(b.startTime)
  );
}

export async function POST(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  const rateLimit = checkRateLimit(`venue-event:${ip}`, 5, 60 * 60 * 1000);

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const rawBody = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!rawBody || typeof rawBody !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const organizerName = readString(rawBody.organizerName);
  const orgName = readOptionalString(rawBody.orgName);
  const contactEmail = readString(rawBody.contactEmail).toLowerCase();
  const contactPhone = readOptionalString(rawBody.contactPhone);
  const title = readString(rawBody.title);
  const type = readString(rawBody.type);
  const dateString = readString(rawBody.date);
  const startTime = readString(rawBody.startTime);
  const endTime = readString(rawBody.endTime);
  const description = readOptionalString(rawBody.description);
  const attendeesResult = readPositiveInteger(rawBody.expectedAttendees);

  if (!organizerName) {
    return NextResponse.json(
      { error: "Please enter the organizer name." },
      { status: 400 }
    );
  }
  if (!title) {
    return NextResponse.json({ error: "Please enter an event title." }, { status: 400 });
  }
  if (!EMAIL_RE.test(contactEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid email." },
      { status: 400 }
    );
  }
  if (!VENUE_EVENT_TYPES.includes(type as VenueEventType)) {
    return NextResponse.json({ error: "Invalid event type." }, { status: 400 });
  }
  if (attendeesResult.invalid) {
    return NextResponse.json(
      { error: "Expected attendees must be a positive integer." },
      { status: 400 }
    );
  }

  const eventDate = parseUtcDate(dateString);
  if (!eventDate) {
    return NextResponse.json(
      { error: "Please enter a valid date in YYYY-MM-DD format." },
      { status: 400 }
    );
  }

  let startMinutes: number;
  let endMinutes: number;
  try {
    startMinutes = parseProjectTimeToMinutes(startTime);
    endMinutes = parseProjectTimeToMinutes(endTime);
  } catch {
    return NextResponse.json(
      { error: "Start time and end time must use the project time format." },
      { status: 400 }
    );
  }

  if (endMinutes <= startMinutes) {
    return NextResponse.json(
      { error: "End time must be after start time." },
      { status: 400 }
    );
  }

  const nextDate = new Date(eventDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);

  try {
    const slug = await createUniqueSlug(title);
    const [sessionConflicts, venueConflicts, jar] = await Promise.all([
      prisma.cohortSession.findMany({
        where: {
          date: {
            gte: eventDate,
            lt: nextDate,
          },
          cohort: {
            status: {
              in: [...PUBLIC_COHORT_STATUSES],
            },
          },
        },
        select: {
          title: true,
          startTime: true,
          endTime: true,
          cohort: {
            select: {
              title: true,
            },
          },
        },
      }),
      prisma.venueEvent.findMany({
        where: {
          status: {
            in: ["APPROVED", "PENDING"],
          },
          date: {
            gte: eventDate,
            lt: nextDate,
          },
        },
        select: {
          status: true,
          startTime: true,
          endTime: true,
        },
      }),
      cookies(),
    ]);

    const conflicts = sortConflicts([
      ...sessionConflicts
        .filter((session) =>
          projectTimeRangesOverlap(startTime, endTime, session.startTime, session.endTime)
        )
        .map((session) => ({
          label: session.title || session.cohort.title,
          startTime: session.startTime,
          endTime: session.endTime,
        })),
      ...venueConflicts
        .filter((event) =>
          projectTimeRangesOverlap(startTime, endTime, event.startTime, event.endTime)
        )
        .map((event) => ({
          label: event.status === "APPROVED" ? "Booked" : "Tentative hold",
          startTime: event.startTime,
          endTime: event.endTime,
        })),
    ]);

    const attribution = parseAttributionCookie(jar.get(ATTRIBUTION_COOKIE)?.value);
    const segment = parseSegmentCookie(jar.get(SEGMENT_COOKIE)?.value);
    const now = new Date();
    const source = "venue-calendar";

    const existingContact = await prisma.contact.findUnique({
      where: { email: contactEmail },
      select: { id: true, tags: true },
    });

    const tags = (() => {
      const next = new Set(safeParseTags(existingContact?.tags ?? null));
      next.add("venue-request");
      if (segment) next.add(`seg-${segment}`);
      return JSON.stringify([...next]);
    })();

    const contact = await prisma.contact.upsert({
      where: { email: contactEmail },
      update: {
        name: organizerName || undefined,
        source,
        tags,
        lastActivityAt: now,
      },
      create: {
        name: organizerName || "Guest",
        email: contactEmail,
        status: "NEW",
        source,
        attribution: attribution ? JSON.stringify(attribution) : null,
        tags,
        lastActivityAt: now,
      },
    });

    await prisma.contactEvent.create({
      data: {
        contactId: contact.id,
        type: "VENUE_EVENT_REQUEST",
        metadata: JSON.stringify({ slug, title, date: dateString }),
        utmSource: attribution?.utm_source ?? null,
        utmMedium: attribution?.utm_medium ?? null,
        utmCampaign: attribution?.utm_campaign ?? null,
        utmContent: attribution?.utm_content ?? null,
      },
    });

    const created = await prisma.venueEvent.create({
      data: {
        slug,
        title,
        type,
        description: description ?? null,
        organizerName,
        orgName: orgName ?? null,
        contactEmail,
        contactPhone: contactPhone ?? null,
        date: eventDate,
        startTime,
        endTime,
        timezone: brand.timezone,
        expectedAttendees: attendeesResult.value ?? null,
        status: "PENDING",
        source: "FORM",
        contactId: contact.id,
      },
    });

    try {
      const gcal = await syncVenueEventToGcal(created.id);
      if (gcal.outcome === "failed") {
        logger.warn({ slug: created.slug, error: gcal.error }, "[venue-events] gcal hold sync failed");
      }
    } catch (err) {
      // syncVenueEventToGcal is documented never to throw; this guard exists so an
      // unexpected throw still cannot fail a request whose row is already committed.
      logger.error({ err, slug: created.slug }, "[venue-events] gcal hold sync threw");
    }

    try {
      const notificationTo =
        process.env.INTERNAL_NOTIFICATION_EMAIL || brand.email.contact;
      const conflictItems = conflicts.length
        ? conflicts
            .map(
              (conflict) =>
                `<li>${escapeHtml(conflict.label)} (${escapeHtml(
                  conflict.startTime
                )} - ${escapeHtml(conflict.endTime)})</li>`
            )
            .join("")
        : "<li>No current conflicts detected.</li>";

      await sendMail({
        to: notificationTo,
        subject: `New venue event request: ${title}`,
        html: `<p>A new venue event request was submitted.</p>
<p><strong>Title:</strong> ${escapeHtml(title)}</p>
<p><strong>Organizer:</strong> ${escapeHtml(organizerName)}</p>
<p><strong>Organization:</strong> ${escapeHtml(orgName || "N/A")}</p>
<p><strong>Email:</strong> ${escapeHtml(contactEmail)}</p>
<p><strong>Phone:</strong> ${escapeHtml(contactPhone || "N/A")}</p>
<p><strong>Type:</strong> ${escapeHtml(type)}</p>
<p><strong>Date:</strong> ${escapeHtml(dateString)}</p>
<p><strong>Time:</strong> ${escapeHtml(startTime)} - ${escapeHtml(endTime)}</p>
<p><strong>Expected attendees:</strong> ${escapeHtml(
  attendeesResult.value ? String(attendeesResult.value) : "N/A"
)}</p>
<p><strong>Slug:</strong> ${escapeHtml(slug)}</p>
<p><strong>Description:</strong><br/>${escapeHtml(description || "N/A").replace(
  /\n/g,
  "<br/>"
)}</p>
<p><strong>Potential conflicts:</strong></p>
<ul>${conflictItems}</ul>`,
      });
    } catch (error) {
      logger.error({ err: error }, "[public venue-events] notification email failed:");
    }

    logger.info({ slug, contactEmail }, "[public venue-events] request captured");
    return NextResponse.json({ ok: true, slug, conflicts }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "[public venue-events] failed to submit request:");
    return NextResponse.json(
      { error: "Unable to submit venue event request." },
      { status: 500 }
    );
  }
}
