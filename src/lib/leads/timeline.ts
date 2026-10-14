// src/lib/leads/timeline.ts
//
// One reverse-chronological feed of everything that has happened to a lead,
// merged from sources that each store their own shape:
//
//   EmailEvent      — what we sent and what they did with it
//   ContactEvent    — asset downloads, lesson views, onboarding submissions
//   DripEnrollment  — campaign lifecycle (enrolled / completed / exited)
//   ContactNote     — the notes journal (system + drip entries; see below)
//   ContactCall     — AI and manually logged phone calls
//   ContactMessage  — inbound and outbound SMS
//   LeadBooking     — 1:1 booking lifecycle
//   Payment         — checkout and purchase lifecycle
//   Membership      — membership checkout and purchase lifecycle
//
// Deliberately cursor-paginated. The older `admin/contacts/activity/page.tsx`
// loads every contact with every event and is a known performance problem — this
// must never grow into that.

import prisma from "@/lib/prisma";
import { callOutcomeLabel } from "@/app/(dashboard)/admin/contacts/callOutcomes";

export type TimelineKind =
  | "email_sent"
  | "email_failed"
  | "email_opened"
  | "email_clicked"
  | "email_unsubscribed"
  | "asset_download"
  | "lesson_view"
  | "onboarding"
  | "manual"
  | "drip_enrolled"
  | "drip_completed"
  | "drip_exited"
  | "checkout_started"
  | "checkout_abandoned"
  | "purchase"
  | "refund"
  | "note"
  | "call_initiated"
  | "call_completed"
  | "call_no_answer"
  | "call_failed"
  | "call_logged"
  | "sms_outbound"
  | "sms_inbound"
  | "booking_created"
  | "booking_cancelled";

export type TimelineItem = {
  /** ISO timestamp. */
  at: string;
  kind: TimelineKind;
  label: string;
  detail?: string;
  href?: string;
  /** email_sent rows only: body + engagement folded from OPENED/CLICKED children. */
  email?: {
    id: string;
    subject?: string;
    bodyHtml?: string;
    campaignName?: string;
    openedAt?: string;
    clickedAt?: string;
    clickedUrl?: string;
  };
  /** call_* rows only: the full call payload for the expandable transcript card. */
  call?: {
    id: string;
    provider: string;
    status: string;
    outcome: string | null;
    durationSec: number | null;
    transcript: string | null;
    summary: string | null;
    recordingUrl: string | null;
    transferredTo: string | null;
    authorLabel: string | null;
  };
};

export type TimelinePage = {
  items: TimelineItem[];
  /** ISO timestamp to pass back as `before`, or null when fully drained. */
  nextCursor: string | null;
};

const DEFAULT_TAKE = 25;

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const EMAIL_KINDS: Record<string, { kind: TimelineKind; label: string }> = {
  SENT: { kind: "email_sent", label: "Email sent" },
  FAILED: { kind: "email_failed", label: "Email failed" },
  OPENED: { kind: "email_opened", label: "Email opened" },
  CLICKED: { kind: "email_clicked", label: "Link clicked" },
  UNSUBSCRIBED: { kind: "email_unsubscribed", label: "Unsubscribed" },
  DELIVERED: { kind: "email_sent", label: "Email delivered" },
  BOUNCED: { kind: "email_failed", label: "Email bounced" },
  COMPLAINED: { kind: "email_failed", label: "Marked as spam" },
};

function bookingDetail(
  startAt: Date,
  endAt: Date,
  timezone: string,
  closerName: string | null,
  closerEmail: string,
): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(startAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const closer = closerName?.trim() || closerEmail;
  return `${date} ${time.format(startAt)}–${time.format(endAt)} with ${closer}`;
}

/**
 * A page of the merged timeline, newest first.
 *
 * Each source is queried for `take + 1` rows older than the cursor, then the
 * union is sorted and sliced. Over-fetching per source is what makes the merge
 * correct: any one source could supply the whole page.
 */
export async function getLeadTimeline(
  contactId: string,
  opts: { take?: number; before?: string | null } = {}
): Promise<TimelinePage> {
  const take = Math.min(Math.max(opts.take ?? DEFAULT_TAKE, 1), 100);
  const before = opts.before ? new Date(opts.before) : null;
  const olderThan = before && !isNaN(before.getTime()) ? { lt: before } : undefined;

  // Money lives in Payment/Membership, which are keyed by buyer email rather
  // than contactId — checkout deliberately creates no Contact. Resolve the
  // email once so "started checkout / abandoned / bought" show up on the lead
  // record next to the emails that caused them.
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true },
  });
  const buyerEmail = contact?.email ?? null;

  const [emailEvents, contactEvents, enrollments, notes, calls, messages, bookings, payments, memberships] =
    await Promise.all([
    prisma.emailEvent.findMany({
      where: { contactId, ...(olderThan ? { createdAt: olderThan } : {}) },
      orderBy: { createdAt: "desc" },
      // The multiplier bounds how many folded open/click children one page of sends can absorb.
      take: Math.min(take * 3 + 1, 200),
      select: {
        id: true,
        type: true,
        subject: true,
        url: true,
        createdAt: true,
        metadata: true,
        bodyHtml: true,
        dripSendId: true,
        dripSend: {
          select: {
            step: { select: { campaign: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
    prisma.contactEvent.findMany({
      where: { contactId, ...(olderThan ? { createdAt: olderThan } : {}) },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      select: { type: true, metadata: true, createdAt: true },
    }),
    prisma.dripEnrollment.findMany({
      where: { contactId },
      orderBy: { enrolledAt: "desc" },
      take: take + 1,
      select: {
        enrolledAt: true,
        completedAt: true,
        exitedAt: true,
        exitReason: true,
        campaign: { select: { name: true, slug: true, id: true } },
      },
    }),
    prisma.contactNote.findMany({
      where: { contactId, ...(olderThan ? { createdAt: olderThan } : {}) },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      select: { body: true, authorLabel: true, kind: true, createdAt: true },
    }),
    prisma.contactCall.findMany({
      where: { contactId, ...(olderThan ? { createdAt: olderThan } : {}) },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      select: {
        id: true,
        provider: true,
        status: true,
        outcome: true,
        durationSec: true,
        transcript: true,
        summary: true,
        recordingUrl: true,
        transferredTo: true,
        authorLabel: true,
        createdAt: true,
      },
    }),
    prisma.contactMessage.findMany({
      where: { contactId, ...(olderThan ? { createdAt: olderThan } : {}) },
      orderBy: { createdAt: "desc" },
      take: take + 1,
      select: {
        id: true,
        body: true,
        direction: true,
        status: true,
        authorLabel: true,
        error: true,
        createdAt: true,
      },
    }),
    prisma.leadBooking.findMany({
      where: { contactId },
      orderBy: { updatedAt: "desc" },
      take: take + 1,
      select: {
        status: true,
        zoomJoinUrl: true,
        createdAt: true,
        updatedAt: true,
        slot: {
          select: {
            startAt: true,
            endAt: true,
            timezone: true,
            closer: { select: { name: true, email: true } },
          },
        },
      },
    }),
    buyerEmail
      ? prisma.payment.findMany({
          where: { buyerEmail },
          orderBy: { createdAt: "desc" },
          take: take + 1,
          select: {
            amount: true,
            currency: true,
            status: true,
            couponCode: true,
            createdAt: true,
            updatedAt: true,
            cohort: { select: { title: true } },
            venueEvent: { select: { title: true } },
          },
        })
      : Promise.resolve([]),
    buyerEmail
      ? prisma.membership.findMany({
          where: { buyerEmail },
          orderBy: { createdAt: "desc" },
          take: take + 1,
          select: {
            amount: true,
            tier: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const items: TimelineItem[] = [];

  const emailParentsByDripSendId = new Map<string, TimelineItem>();
  const emailParentsById = new Map<string, TimelineItem>();

  // First emit SENT/DELIVERED parents so engagement can fold into them even
  // though the source rows arrive newest-first (children before their send).
  for (const e of emailEvents) {
    const mapped = EMAIL_KINDS[e.type];
    if (mapped?.kind !== "email_sent") continue;

    const meta = safeJson<{ error?: string; kind?: string }>(e.metadata, {});
    const label = meta.kind === "oneoff" ? `One-off ${mapped.label.toLowerCase()}` : mapped.label;
    const item: TimelineItem = {
      at: e.createdAt.toISOString(),
      kind: mapped.kind,
      label,
      detail: e.subject ?? undefined,
      href: e.url ?? undefined,
      ...(meta.error ? { detail: `${e.subject ?? "—"} · ${meta.error}` } : {}),
      email: {
        id: e.id,
        subject: e.subject ?? undefined,
        bodyHtml: e.bodyHtml ?? undefined,
        campaignName: e.dripSend?.step?.campaign?.name ?? undefined,
      },
    };
    items.push(item);
    emailParentsById.set(e.id, item);
    if (e.dripSendId) emailParentsByDripSendId.set(e.dripSendId, item);
  }

  // Then fold OPENED/CLICKED rows when their parent is in this bounded fetch.
  // Orphans deliberately fall through to the legacy standalone representation.
  for (const e of emailEvents) {
    const knownMapping = EMAIL_KINDS[e.type];
    if (knownMapping?.kind === "email_sent") continue;

    const mapped = knownMapping ?? { kind: "email_sent" as TimelineKind, label: e.type };
    const meta = safeJson<{ error?: string; kind?: string; sourceEmailEventId?: string }>(
      e.metadata,
      {},
    );
    if (e.type === "OPENED" || e.type === "CLICKED") {
      const parent = e.dripSendId
        ? emailParentsByDripSendId.get(e.dripSendId)
        : meta.sourceEmailEventId
          ? emailParentsById.get(meta.sourceEmailEventId)
          : undefined;
      if (parent?.email) {
        if (e.type === "OPENED" && !parent.email.openedAt) {
          parent.email.openedAt = e.createdAt.toISOString();
        }
        if (e.type === "CLICKED" && !parent.email.clickedAt) {
          parent.email.clickedAt = e.createdAt.toISOString();
          parent.email.clickedUrl = e.url ?? undefined;
        }
        continue;
      }
    }

    const label = meta.kind === "oneoff" ? `One-off ${mapped.label.toLowerCase()}` : mapped.label;
    items.push({
      at: e.createdAt.toISOString(),
      kind: mapped.kind,
      label,
      detail: e.subject ?? undefined,
      href: e.url ?? undefined,
      ...(meta.error ? { detail: `${e.subject ?? "—"} · ${meta.error}` } : {}),
    });
  }

  for (const e of contactEvents) {
    const meta = safeJson<{
      fileName?: string;
      lessonTitle?: string;
      formSlug?: string;
      kind?: string;
      refId?: string;
    }>(
      e.metadata,
      {}
    );
    if (e.type === "ASSET_DOWNLOAD") {
      items.push({
        at: e.createdAt.toISOString(),
        kind: "asset_download",
        label: "Downloaded an asset",
        detail: meta.fileName,
      });
    } else if (e.type === "LESSON_VIEW") {
      items.push({
        at: e.createdAt.toISOString(),
        kind: "lesson_view",
        label: "Viewed a lesson",
        detail: meta.lessonTitle,
      });
    } else if (e.type === "ONBOARDING") {
      items.push({
        at: e.createdAt.toISOString(),
        kind: "onboarding",
        label: "Submitted the onboarding quiz",
        detail: meta.formSlug,
      });
    } else if (e.type === "PURCHASE") {
      items.push({
        at: e.createdAt.toISOString(),
        kind: "purchase",
        label: meta.kind ? `Purchase: ${meta.kind}` : "Purchase",
        detail: meta.refId,
      });
    } else {
      items.push({ at: e.createdAt.toISOString(), kind: "manual", label: "Manual entry" });
    }
  }

  // Enrollment lifecycle: one row can contribute up to three dated moments, each
  // filtered against the cursor individually since they happened at different times.
  for (const en of enrollments) {
    const cutoff = olderThan ? before! : null;
    const push = (at: Date | null, kind: TimelineKind, label: string, detail?: string) => {
      if (!at) return;
      if (cutoff && at >= cutoff) return;
      items.push({ at: at.toISOString(), kind, label, detail });
    };
    push(en.enrolledAt, "drip_enrolled", "Enrolled in campaign", en.campaign.name);
    push(en.completedAt, "drip_completed", "Finished campaign", en.campaign.name);
    push(
      en.exitedAt,
      "drip_exited",
      "Left campaign",
      en.exitReason ? `${en.campaign.name} · ${en.exitReason}` : en.campaign.name
    );
  }

  // Checkouts contribute two dated moments: the attempt (createdAt) and its
  // outcome (updatedAt, once it left `pending`). Each is cursor-filtered on its
  // own, exactly like the enrollment lifecycle above.
  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);

  const cutoff = olderThan ? before! : null;
  const pushDated = (
    at: Date | null,
    kind: TimelineKind,
    label: string,
    detail?: string,
    href?: string,
  ) => {
    if (!at) return;
    if (cutoff && at >= cutoff) return;
    items.push({ at: at.toISOString(), kind, label, detail, href });
  };

  for (const payment of payments) {
    const what =
      payment.cohort?.title ??
      (payment.venueEvent ? `Venue — ${payment.venueEvent.title}` : "Checkout");
    const price = money(payment.amount, payment.currency);
    const withCode = payment.couponCode ? `${price} · ${payment.couponCode}` : price;

    pushDated(payment.createdAt, "checkout_started", "Started checkout", `${what} · ${withCode}`);
    if (payment.status === "paid") {
      pushDated(payment.updatedAt, "purchase", "Paid", `${what} · ${withCode}`);
    } else if (payment.status === "failed") {
      pushDated(payment.updatedAt, "checkout_abandoned", "Abandoned checkout", `${what} · ${price}`);
    } else if (payment.status === "refunded") {
      pushDated(payment.updatedAt, "refund", "Refunded", `${what} · ${price}`);
    }
  }

  for (const membership of memberships) {
    const label = `Membership · ${membership.tier}`;
    const price = `${money(membership.amount, "usd")}/mo`;
    pushDated(membership.createdAt, "checkout_started", "Started membership checkout", `${label} · ${price}`);
    if (membership.status === "active" || membership.status === "past_due") {
      pushDated(membership.updatedAt, "purchase", "Membership active", `${label} · ${price}`);
    } else if (membership.status === "expired") {
      pushDated(membership.updatedAt, "checkout_abandoned", "Abandoned membership checkout", label);
    }
  }

  for (const c of calls) {
    const isManual = c.provider === "manual";
    const kind: TimelineKind = isManual
      ? "call_logged"
      : c.status === "COMPLETED" || c.status === "TRANSFERRED"
        ? "call_completed"
        : c.status === "NO_ANSWER" || c.status === "VOICEMAIL"
          ? "call_no_answer"
          : c.status === "FAILED"
            ? "call_failed"
            : "call_initiated";
    const label = isManual
      ? "Call logged"
      : c.status === "TRANSFERRED"
        ? "AI call — transferred to a human"
        : c.status === "COMPLETED"
          ? "AI call completed"
          : c.status === "VOICEMAIL"
            ? "AI call — voicemail"
            : c.status === "NO_ANSWER"
              ? "AI call — no answer"
              : c.status === "FAILED"
                ? "AI call failed"
                : "AI call placed";
    const bits = [
      callOutcomeLabel(c.outcome) ?? undefined,
      typeof c.durationSec === "number"
        ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}`
        : undefined,
      c.authorLabel ?? undefined,
    ].filter(Boolean);
    items.push({
      at: c.createdAt.toISOString(),
      kind,
      label,
      detail: c.summary ?? (bits.length ? bits.join(" · ") : undefined),
      call: {
        id: c.id,
        provider: c.provider,
        status: c.status,
        outcome: c.outcome,
        durationSec: c.durationSec,
        transcript: c.transcript,
        summary: c.summary,
        recordingUrl: c.recordingUrl,
        transferredTo: c.transferredTo,
        authorLabel: c.authorLabel,
      },
    });
  }

  for (const message of messages) {
    const outbound = message.direction === "OUTBOUND";
    const body = message.body.slice(0, 200);
    items.push({
      at: message.createdAt.toISOString(),
      kind: outbound ? "sms_outbound" : "sms_inbound",
      label:
        message.status === "FAILED" ? "SMS failed" : outbound ? "SMS sent" : "SMS received",
      detail: message.authorLabel ? `${body} · ${message.authorLabel}` : body,
    });
  }

  for (const booking of bookings) {
    const detail = bookingDetail(
      booking.slot.startAt,
      booking.slot.endAt,
      booking.slot.timezone,
      booking.slot.closer.name,
      booking.slot.closer.email,
    );
    const href = booking.zoomJoinUrl?.trim() || undefined;
    pushDated(booking.createdAt, "booking_created", "Booked a 1:1", detail, href);
    pushDated(
      booking.status === "CANCELLED" ? booking.updatedAt : null,
      "booking_cancelled",
      "Cancelled a 1:1",
      detail,
      href,
    );
  }

  for (const n of notes) {
    items.push({
      at: n.createdAt.toISOString(),
      kind: "note",
      label: n.kind === "DRIP_TASK" ? "Follow-up task" : "Note",
      detail: `${n.authorLabel}: ${n.body}`,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const page = items.slice(0, take);
  // More remains only if we actually dropped something; a short page is the end.
  const nextCursor = items.length > take && page.length > 0 ? page[page.length - 1].at : null;

  return { items: page, nextCursor };
}
