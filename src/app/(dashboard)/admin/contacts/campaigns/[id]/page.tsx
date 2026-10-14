// src/app/(dashboard)/admin/contacts/campaigns/[id]/page.tsx

import { auth } from "@/lib/auth";
import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Send } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { hasAnyRole } from "@/lib/roles";
import { parseSegment } from "@/lib/drip/segment";
import {
  getUpcomingCohorts,
  renderNextCohortLine,
  renderUpcomingCohortsHtml,
} from "@/lib/drip/cohorts";
import { getCampaignFunnel } from "@/lib/drip/funnel";
import CampaignEditor, {
  type CampaignDetail,
  type EnrollmentRow,
  type PreviewMergeContext,
  type SendRow,
} from "./CampaignEditor";

export const metadata = { title: "Campaign | Admin" };

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function parseStatusList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    // A hand-edited or legacy row should not blank the whole editor.
    return [];
  }
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const baseAppUrl = appUrl();

  const campaign = await prisma.dripCampaign.findUnique({
    where: { id },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!campaign) notFound();

  const [enrollments, sends, funnel, upcomingCohorts] = await Promise.all([
    prisma.dripEnrollment.findMany({
      where: { campaignId: id },
      orderBy: { enrolledAt: "desc" },
      take: 50,
      include: { contact: { select: { name: true, email: true } } },
    }),
    prisma.dripSend.findMany({
      where: { enrollment: { campaignId: id } },
      orderBy: { sentAt: "desc" },
      take: 50,
      include: {
        step: { select: { order: true } },
        enrollment: { select: { contact: { select: { email: true } } } },
      },
    }),
    // Per-step funnel: reach, delivery health, engagement, live position and
    // drop-off. Subsumes the old per-step engagement query AND the enrollment
    // status groupBy — see src/lib/drip/funnel.ts for why one query can't serve
    // both the drop-off chain and the open/click rates.
    getCampaignFunnel(
      id,
      campaign.steps.map((s) => ({ id: s.id, order: s.order, channel: s.channel }))
    ),
    getUpcomingCohorts(baseAppUrl).catch(() => []),
  ]);

  const funnelByOrder = new Map(funnel.steps.map((s) => [s.order, s]));

  const detail: CampaignDetail = {
    id: campaign.id,
    slug: campaign.slug,
    name: campaign.name,
    description: campaign.description ?? "",
    status: campaign.status,
    trigger: campaign.trigger,
    priority: campaign.priority,
    autoEnroll: campaign.autoEnroll,
    timezone: campaign.timezone,
    sendWindowStartHour: campaign.sendWindowStartHour,
    sendWindowEndHour: campaign.sendWindowEndHour,
    skipWeekends: campaign.skipWeekends,
    exitOnStatuses: parseStatusList(campaign.exitOnStatuses),
    testEmail: campaign.testEmail,
    segment: parseSegment(campaign.segment),
    steps: campaign.steps.map((s) => ({
      id: s.id,
      order: s.order,
      delayHours: s.delayHours,
      anchor: s.anchor,
      offsetMinutes: s.offsetMinutes,
      channel: s.channel,
      subject: s.subject,
      body: s.body,
      ctaLabel: s.ctaLabel ?? "",
      ctaUrl: s.ctaUrl ?? "",
      callAssistantId: s.callAssistantId ?? "",
      callFirstMessage: s.callFirstMessage ?? "",
      funnel: funnelByOrder.get(s.order) ?? {
        order: s.order,
        reached: 0,
        delivered: 0,
        failed: 0,
        taskLogged: 0,
        opened: 0,
        clicked: 0,
        unsubscribed: 0,
        waiting: 0,
        paused: 0,
        stepRetentionPct: null,
        cumulativeRetentionPct: null,
      },
    })),
    funnelTotals: funnel.totals,
    recovered: funnel.recovered,
  };

  const enrollmentRows: EnrollmentRow[] = enrollments.map((e) => ({
    id: e.id,
    name: e.contact.name,
    email: e.contact.email,
    status: e.status,
    lastStepOrder: e.lastStepOrder,
    nextRunAt: e.nextRunAt ? e.nextRunAt.toISOString() : null,
    exitReason: e.exitReason ?? null,
  }));

  const sendRows: SendRow[] = sends.map((s) => ({
    id: s.id,
    stepOrder: s.step.order,
    email: s.enrollment.contact.email,
    status: s.status,
    sentAt: s.sentAt.toISOString(),
    error: s.error ?? null,
  }));

  // Derived from the same groupBy that produces per-step `waiting`, so the
  // header counts and the funnel table can never disagree.
  const counts = funnel.enrollmentCounts;

  const previewMergeContext: PreviewMergeContext = {
    name: "Test Recipient",
    email: brand.email.preview,
    unsubscribeUrl: `${baseAppUrl}/unsubscribe?token=preview-not-a-real-token`,
    appUrl: baseAppUrl,
    campaignSlug: campaign.slug,
    // Keyed by step order, not a single flat string: the real send tags each
    // step's cohort links with that step's own UTM content (step1-cohort-x,
    // step3-cohort-x, …), so the preview has to vary the same way per step or
    // it would show every step pointing at identically-tagged links.
    perStepUpcomingCohortsHtml: Object.fromEntries(
      campaign.steps.map((s) => [
        s.order,
        renderUpcomingCohortsHtml(upcomingCohorts, baseAppUrl, {
          campaign: campaign.slug,
          stepOrder: s.order,
        }),
      ])
    ),
    nextCohortLine: renderNextCohortLine(upcomingCohorts),
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 z-10 gap-3 shadow-sm">
        <MobileMenuButton />
        <Link
          href="/admin/contacts/campaigns"
          className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-primary transition-colors min-h-[44px]"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Campaigns</span>
        </Link>
        <Send className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white truncate">
          {campaign.name}
        </h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <CampaignEditor
            campaign={detail}
            enrollments={enrollmentRows}
            sends={sendRows}
            counts={counts}
            previewMergeContext={previewMergeContext}
          />
        </div>
      </main>
    </div>
  );
}
