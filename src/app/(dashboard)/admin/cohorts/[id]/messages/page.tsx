import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { auth } from "@/lib/auth";
import { canSendCohortMessages } from "@/lib/cohortMessages/actionGuard";
import {
  buildHistoryRows,
  historySenderIds,
  type CohortMessageHistoryStats,
  type CohortMessageHistoryUser,
} from "@/lib/cohortMessages/composerState";
import { isTransactionalSmsEnabled } from "@/lib/cohortMessages/send";
import { COHORT_MESSAGE_TRIGGER } from "@/lib/drip/constants";
import prisma from "@/lib/prisma";
import { resolveIanaZone } from "@/lib/sessionInstant";
import { MessageComposer } from "./MessageComposer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cohort Messages | Admin" };

function formatCalendarDate(date: Date | null): string {
  if (!date) return "TBD";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTimestamp(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    timeZoneName: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function CohortMessagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !canSendCohortMessages(session.user)) {
    redirect("/dashboard");
  }

  const { id: cohortId } = await params;
  // The cohort workspace URL takes an id or a slug; accept both here too.
  const cohort = await prisma.cohort.findFirst({
    where: { OR: [{ id: cohortId }, { slug: cohortId }] },
    select: {
      id: true,
      slug: true,
      title: true,
      startDate: true,
      endDate: true,
      timezone: true,
    },
  });
  if (!cohort) notFound();
  const cohortZone = resolveIanaZone(cohort.timezone);

  const [smsEnabled, campaigns] = await Promise.all([
    isTransactionalSmsEnabled(),
    prisma.dripCampaign.findMany({
      where: { trigger: COHORT_MESSAGE_TRIGGER, cohortId: cohort.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        sentAt: true,
        createdAt: true,
        audienceSnapshot: true,
      },
    }),
  ]);

  const senderIds = historySenderIds(campaigns);
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const [senders, deliveredSends] = await Promise.all([
    senderIds.length
      ? prisma.user.findMany({
          where: { id: { in: senderIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    campaignIds.length
      ? prisma.dripSend.findMany({
          where: {
            status: "SENT",
            enrollment: { campaignId: { in: campaignIds } },
            step: { channel: "EMAIL" },
          },
          select: {
            openedAt: true,
            enrollment: { select: { campaignId: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const usersById = new Map<string, CohortMessageHistoryUser>(
    senders.map((user) => [user.id, { name: user.name, email: user.email }])
  );
  const statsByCampaign = new Map<string, CohortMessageHistoryStats>();
  for (const send of deliveredSends) {
    const campaignId = send.enrollment.campaignId;
    const current = statsByCampaign.get(campaignId) ?? { delivered: 0, opened: 0 };
    current.delivered += 1;
    if (send.openedAt) current.opened += 1;
    statsByCampaign.set(campaignId, current);
  }
  const history = buildHistoryRows(campaigns, usersById, statsByCampaign);
  const cohortHref = `/cohorts/${cohort.slug || cohort.id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex min-h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:px-8">
        <MobileMenuButton />
        <Mail className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-slate-900 dark:text-white md:text-xl">
            Cohort messages
          </h1>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {cohort.title}
          </p>
        </div>
        <Link
          href={cohortHref}
          className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to cohort</span>
        </Link>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">
              {cohort.title}
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Send a logistics update
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {formatCalendarDate(cohort.startDate)} — {formatCalendarDate(cohort.endDate)} · {cohortZone}
            </p>
          </div>

          <MessageComposer
            cohortId={cohort.id}
            cohortTimezone={cohortZone}
            smsEnabled={smsEnabled}
          />

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800 md:px-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Message history
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                The 50 most recent cohort messages. Opens are directional because of mail privacy tools.
              </p>
            </div>

            {history.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-500">
                No cohort messages have been sent yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-950/40">
                    <tr>
                      <th className="px-5 py-3">Submitted</th>
                      <th className="px-5 py-3">Sender</th>
                      <th className="px-5 py-3 text-right">Audience</th>
                      <th className="px-5 py-3 text-right">Email</th>
                      <th className="px-5 py-3 text-right">Text</th>
                      <th className="px-5 py-3 text-right">Delivered</th>
                      <th className="px-5 py-3 text-right">Opened</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800 dark:text-slate-300">
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-5 py-4">
                          <p className="font-medium text-slate-900 dark:text-white">
                            {formatTimestamp(row.sentAt, cohortZone)}
                          </p>
                          {row.scheduledFor && (
                            <p className="mt-0.5 text-xs text-slate-500">
                              Scheduled for {formatTimestamp(row.scheduledFor, cohortZone)}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">{row.senderName}</td>
                        <td className="px-5 py-4 text-right tabular-nums">{row.total}</td>
                        <td className="px-5 py-4 text-right tabular-nums">{row.emailCount}</td>
                        <td className="px-5 py-4 text-right tabular-nums">{row.smsCount}</td>
                        <td className="px-5 py-4 text-right tabular-nums">
                          {row.delivered ?? "—"}
                        </td>
                        <td className="px-5 py-4 text-right tabular-nums">
                          {row.opened ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
