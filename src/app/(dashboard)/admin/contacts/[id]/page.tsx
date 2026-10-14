// src/app/(dashboard)/admin/contacts/[id]/page.tsx
//
// The lead profile: everything you need before picking up the phone, on one page.
// Before this existed, working a lead meant switching between the leads table,
// the onboarding-responses table, and the campaign editor.

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { hasAnyRole } from "@/lib/roles";
import { getLeadTimeline } from "@/lib/leads/timeline";
import { findUserIdForContact, getTrackRecord } from "@/lib/trackRecord";
import { parseStoredBrief } from "@/lib/leads/brief";
import TrackRecordPanel from "@/components/track-record/TrackRecordPanel";
import LeadProfileClient, {
  type LeadProfile,
  type AnsweredQuestion,
} from "./LeadProfileClient";

export const metadata = { title: "Lead | Admin" };

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Same include the onboarding admin uses — needed to resolve answer ids to labels. */
const responseInclude = {
  form: {
    include: {
      steps: {
        orderBy: { order: "asc" as const },
        include: {
          elements: {
            orderBy: { order: "asc" as const },
            include: { options: { orderBy: { order: "asc" as const } } },
          },
        },
      },
    },
  },
};

type ResponseWithForm = {
  id: string;
  answers: string;
  createdAt: Date;
  form: {
    slug: string;
    title: string;
    steps: Array<{
      elements: Array<{
        id: string;
        label: string;
        options: Array<{ id: string; text: string }>;
      }>;
    }>;
  };
};

/**
 * Turns `{ elementId: optionId | text }` into readable question/answer pairs.
 * Answers are stored as raw ids, so without the form's own elements and options
 * a response is unreadable — which is exactly why this page loads them.
 */
function resolveAnswers(response: ResponseWithForm): AnsweredQuestion[] {
  const answers = safeJson<Record<string, string | string[]>>(response.answers, {});
  const out: AnsweredQuestion[] = [];

  for (const step of response.form.steps) {
    for (const element of step.elements) {
      const raw = answers[element.id];
      if (raw === undefined || raw === null) continue;

      const values = Array.isArray(raw) ? raw : [raw];
      const labels = values.map((v) => element.options.find((o) => o.id === v)?.text ?? v);
      if (labels.length === 0) continue;

      out.push({ question: element.label, answers: labels });
    }
  }
  return out;
}

export default async function LeadProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      dripEnrollments: {
        orderBy: { enrolledAt: "desc" },
        include: { campaign: { select: { id: true, name: true, slug: true, _count: { select: { steps: true } } } } },
      },
      contactNotes: { orderBy: { createdAt: "desc" }, take: 50 },
      events: {
        where: { onboardingResponseId: { not: null } },
        select: { onboardingResponseId: true },
      },
    },
  });
  if (!contact) notFound();

  const responseIds = contact.events
    .map((e) => e.onboardingResponseId)
    .filter((v): v is string => Boolean(v));

  const now = new Date();
  const [timeline, responses, engagement, smsMessages, upcomingBookings, pastBookings] = await Promise.all([
    getLeadTimeline(id, { take: 25 }),
    responseIds.length
      ? prisma.onboardingResponse.findMany({
          where: { id: { in: responseIds } },
          orderBy: { createdAt: "desc" },
          include: responseInclude,
        })
      : Promise.resolve([]),
    prisma.emailEvent.groupBy({
      by: ["type"],
      where: { contactId: id },
      _count: { _all: true },
    }),
    prisma.contactMessage.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        direction: true,
        body: true,
        status: true,
        error: true,
        authorLabel: true,
        createdAt: true,
      },
    }),
    prisma.leadBooking.findMany({
      where: { contactId: id, slot: { startAt: { gte: now } } },
      orderBy: { slot: { startAt: "asc" } },
      select: {
        id: true,
        status: true,
        zoomJoinUrl: true,
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
    prisma.leadBooking.findMany({
      where: { contactId: id, slot: { startAt: { lt: now } } },
      orderBy: { slot: { startAt: "desc" } },
      take: 3,
      select: {
        id: true,
        status: true,
        zoomJoinUrl: true,
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
  ]);

  const countOf = (type: string) =>
    engagement.find((g) => g.type === type)?._count._all ?? 0;

  const profile: LeadProfile = {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone ?? null,
    birthday: contact.birthday ?? null,
    status: contact.status ?? "NEW",
    excludeFromPipeline: contact.excludeFromPipeline,
    source: contact.source ?? null,
    attribution: safeJson<Record<string, string>>(contact.attribution, {}),
    tags: safeJson<string[]>(contact.tags, []),
    notes: contact.notes ?? null,
    createdAt: contact.createdAt.toISOString(),
    lastActivityAt: contact.lastActivityAt ? contact.lastActivityAt.toISOString() : null,
    unsubscribedAt: contact.unsubscribedAt ? contact.unsubscribedAt.toISOString() : null,
    phoneConsentAt: contact.phoneConsentAt ? contact.phoneConsentAt.toISOString() : null,
    smsMarketingConsentAt: contact.smsMarketingConsentAt
      ? contact.smsMarketingConsentAt.toISOString()
      : null,
    smsTransactionalConsentAt: contact.smsTransactionalConsentAt
      ? contact.smsTransactionalConsentAt.toISOString()
      : null,
    smsOptOutAt: contact.smsOptOutAt ? contact.smsOptOutAt.toISOString() : null,
    doNotCall: contact.doNotCall,
    enrollments: contact.dripEnrollments.map((e) => ({
      id: e.id,
      campaignId: e.campaign.id,
      campaignName: e.campaign.name,
      status: e.status,
      lastStepOrder: e.lastStepOrder,
      stepCount: e.campaign._count.steps,
      nextRunAt: e.nextRunAt ? e.nextRunAt.toISOString() : null,
      exitReason: e.exitReason ?? null,
      enrolledAt: e.enrolledAt.toISOString(),
    })),
    journal: contact.contactNotes.map((n) => ({
      id: n.id,
      body: n.body,
      authorLabel: n.authorLabel,
      kind: n.kind,
      createdAt: n.createdAt.toISOString(),
    })),
    responses: (responses as ResponseWithForm[]).map((r) => ({
      id: r.id,
      formTitle: r.form.title,
      formSlug: r.form.slug,
      submittedAt: r.createdAt.toISOString(),
      answers: resolveAnswers(r),
    })),
    engagement: {
      sent: countOf("SENT"),
      opened: countOf("OPENED"),
      clicked: countOf("CLICKED"),
      failed: countOf("FAILED"),
    },
    aiBrief: parseStoredBrief(contact.aiBrief),
  };

  const linkedUserId = await findUserIdForContact({
    userId: contact.userId,
    email: contact.email,
  });
  const [trackRecord, linkedUser] = linkedUserId
    ? await Promise.all([
        getTrackRecord(linkedUserId),
        prisma.user.findUnique({
          where: { id: linkedUserId },
          select: { id: true, email: true, name: true },
        }),
      ])
    : [null, null];

  return (
    <LeadProfileClient
      lead={profile}
      initialTimeline={timeline}
      smsThread={smsMessages.reverse().map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      }))}
      bookings={[...upcomingBookings, ...pastBookings].map((booking) => ({
        id: booking.id,
        status: booking.status,
        startAt: booking.slot.startAt.toISOString(),
        endAt: booking.slot.endAt.toISOString(),
        timezone: booking.slot.timezone,
        closerName: booking.slot.closer.name?.trim() || booking.slot.closer.email,
        zoomJoinUrl: booking.zoomJoinUrl,
      }))}
      trackRecord={
        trackRecord ? (
          <TrackRecordPanel record={trackRecord} />
        ) : null
      }
      linkedUser={linkedUser}
    />
  );
}
