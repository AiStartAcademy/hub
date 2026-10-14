// src/app/api/cohorts/[id]/register-free/route.ts
// POST — a free seat in a cohort, without Stripe.
//
// Open when the cohort is a lead magnet OR the chosen group costs $0. Captures
// the Contact lead as before (first-touch attribution, tags, events), then grants
// the seat through freeSeat.grantFreeSeat (User + GroupMember + Enrollment) and
// emails the next session's join link plus a set-password link for a brand-new
// account. Because it now creates accounts and issues setup tokens, it is
// rate-limited on IP and on email like /api/lead/claim-account.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { sendFreeSeatEmail } from "@/lib/mail";
import {
  ATTRIBUTION_COOKIE,
  SEGMENT_COOKIE,
  parseAttributionCookie,
  parseSegmentCookie,
} from "@/lib/attribution";
import { logger } from "@/lib/logger";
import { WAIVER_VERSION } from "@/lib/waiver";
import { cohortTag, enrollInCohortReminderCampaigns } from "@/lib/drip/cohortAnchor";
import {
  GroupFullError,
  grantFreeSeat,
  isFreeGroup,
  nextSessionJoinLink,
  waiverRequired,
} from "@/lib/freeSeat";
import { hasRole } from "@/lib/roles";
import { checkRateLimit } from "@/lib/rateLimit";
import { normalizeEmail, sanitizePlainText } from "@/lib/onboarding-security";
import { generateAccountSetupToken } from "@/lib/tokens";

const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;
const SETUP_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

/** Statuses in which nobody may register, whatever the price. */
const CLOSED_STATUSES = new Set(["DRAFT", "ARCHIVED", "COMPLETE"]);

type Body = {
  name?: unknown;
  email?: unknown;
  waiverAccepted?: unknown;
  groupId?: unknown;
};

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ipLimit = checkRateLimit(`register-free:ip:${getClientIp(req)}`, IP_LIMIT, WINDOW_MS);
  if (ipLimit.limited) return tooMany(ipLimit.retryAfterSeconds);

  const { id } = await params;
  const raw = (await req.json().catch(() => null)) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const body = raw as Body;

  // Identity: the session wins over the body so a signed-in student can't
  // register someone else, and staff never land on a student roster.
  const session = await auth();
  let email: string | null;
  let name: string | null;
  const authenticated = Boolean(session?.user);
  if (session?.user) {
    if (!hasRole(session.user, "STUDENT")) {
      return NextResponse.json(
        { error: "Only students can register for a seat" },
        { status: 403 }
      );
    }
    email = normalizeEmail(session.user.email);
    name = sanitizePlainText(session.user.name, 200) || null;
    if (!email) {
      return NextResponse.json({ error: "Your account has no valid email." }, { status: 400 });
    }
  } else {
    email = normalizeEmail(body.email);
    name = sanitizePlainText(body.name, 200) || null;
    if (!email) {
      return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
    }
  }

  // Second key on the email so a rotated-IP attacker can't hammer one address.
  const emailLimit = checkRateLimit(`register-free:email:${email}`, EMAIL_LIMIT, WINDOW_MS);
  if (emailLimit.limited) return tooMany(emailLimit.retryAfterSeconds);

  const cohort = await prisma.cohort.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: {
      id: true,
      slug: true,
      title: true,
      leadMagnet: true,
      zoomLink: true,
      status: true,
      deliveryMode: true,
      groups: { select: { id: true, price: true, inPerson: true } },
      sessions: {
        select: {
          id: true,
          date: true,
          startTime: true,
          endTime: true,
          timezone: true,
          meetingLink: true,
        },
      },
    },
  });
  if (!cohort) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (CLOSED_STATUSES.has(cohort.status)) {
    return NextResponse.json(
      { error: "This event is not open for registration." },
      { status: 400 }
    );
  }

  // Which door: a $0 group of this cohort, or the cohort-wide lead-magnet flag.
  const groupId = typeof body.groupId === "string" && body.groupId.trim() ? body.groupId.trim() : null;
  const group = groupId ? cohort.groups.find((g) => g.id === groupId) ?? null : null;
  if (groupId && !group) {
    return NextResponse.json({ error: "Group not found for this event." }, { status: 400 });
  }
  if (group && !isFreeGroup(group)) {
    return NextResponse.json(
      { error: "This group is paid — use checkout." },
      { status: 400 }
    );
  }
  if (!group && !cohort.leadMagnet) {
    return NextResponse.json(
      { error: "This event is not open for free registration." },
      { status: 400 }
    );
  }

  // Anyone attending in person at the venue must accept the visitor waiver.
  const requiresWaiver = waiverRequired({ group, cohort });
  if (requiresWaiver && body.waiverAccepted !== true) {
    return NextResponse.json(
      { error: "Please accept the visitor waiver to register." },
      { status: 400 }
    );
  }

  // First-touch attribution + segment from the cookies UtmCapture set on landing.
  const jar = await cookies();
  const attribution = parseAttributionCookie(jar.get(ATTRIBUTION_COOKIE)?.value);
  const segment = parseSegmentCookie(jar.get(SEGMENT_COOKIE)?.value);
  const now = new Date();
  const source = `lead_magnet:${cohort.slug || cohort.id}`;

  // Upsert the lead — preserve first-touch attribution on repeat registrations.
  const existing = await prisma.contact.findUnique({ where: { email }, select: { id: true, tags: true } });
  const tags = (() => {
    const cur = existing?.tags ? (JSON.parse(existing.tags) as string[]) : [];
    const next = new Set(cur);
    next.add("lead-magnet");
    next.add(cohortTag(cohort)); // Makes them sweepable by the cohort reminder drip.
    if (segment) next.add(`seg-${segment}`);
    return JSON.stringify([...next]);
  })();

  const contact = await prisma.contact.upsert({
    where: { email },
    update: { name: name || undefined, source, tags, lastActivityAt: now },
    create: {
      name: name || "Guest",
      email,
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
      type: "COHORT_REGISTER",
      metadata: JSON.stringify({
        cohortId: cohort.id,
        title: cohort.title,
        kind: group ? "free_group" : "lead_magnet",
        groupId: group?.id ?? null,
      }),
      utmSource: attribution?.utm_source ?? null,
      utmMedium: attribution?.utm_medium ?? null,
      utmCampaign: attribution?.utm_campaign ?? null,
      utmContent: attribution?.utm_content ?? null,
    },
  });

  // Waiver acceptance is recorded as a Contact event rather than a Cohort schema
  // change — the same shape the venue-event flow uses, so both sources are queryable.
  if (requiresWaiver) {
    await prisma.contactEvent.create({
      data: {
        contactId: contact.id,
        type: "WAIVER_ACCEPTED",
        metadata: JSON.stringify({
          version: WAIVER_VERSION,
          context: "cohort",
          cohortId: cohort.id,
          groupId: group?.id ?? null,
          deliveryMode: cohort.deliveryMode,
        }),
      },
    });
  }

  // The seat itself: account + group membership + enrollment, idempotent.
  let seat: Awaited<ReturnType<typeof grantFreeSeat>>;
  try {
    seat = await grantFreeSeat({
      cohortId: cohort.id,
      groupId: group?.id ?? null,
      email,
      name,
      attribution: attribution ? JSON.stringify(attribution) : null,
      segment,
    });
  } catch (error) {
    if (error instanceof GroupFullError) {
      return error.reason === "full"
        ? NextResponse.json({ error: "This group is full" }, { status: 409 })
        : NextResponse.json({ error: "Group not found for this event." }, { status: 400 });
    }
    logger.error({ err: error }, "[register-free] grantFreeSeat failed");
    return NextResponse.json({ error: "Failed to register" }, { status: 500 });
  }

  const cohortPath = `/cohorts/${cohort.slug || cohort.id}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const next = nextSessionJoinLink(cohort, now);

  // Confirmation email with the next session's join link (no-ops in dev without SMTP).
  try {
    const setupToken = seat.isNewAccount
      ? (await generateAccountSetupToken(email, { ttlMs: SETUP_TOKEN_TTL_MS })).token
      : null;
    await sendFreeSeatEmail({
      to: email,
      name,
      cohortTitle: cohort.title,
      whenLine: next?.whenLine ?? null,
      joinLink: next?.link ?? null,
      setupToken,
      cohortUrl: `${appUrl}${cohortPath}`,
    });
  } catch (e) {
    logger.error({ err: e }, "[register-free] email failed (seat still granted):");
  }

  // Pre-start reminder sequence. skipWelcome: the confirmation above already IS
  // the welcome touch — they get T-7d/T-1d/T-2h only. Never throws.
  await enrollInCohortReminderCampaigns(email, name, cohort.id, { skipWelcome: true });

  logger.info(`[register-free] seat granted for ${cohort.slug || cohort.id}: ${email}`);
  return NextResponse.json({
    ok: true,
    enrolled: true,
    cohortUrl: cohortPath,
    // Only a verified identity gets the link on-page; a guest's email is unverified.
    ...(authenticated && next?.link ? { joinLink: next.link } : {}),
  });
}
