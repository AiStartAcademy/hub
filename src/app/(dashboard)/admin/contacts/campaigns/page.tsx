// src/app/(dashboard)/admin/contacts/campaigns/page.tsx

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Send } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { hasAnyRole } from "@/lib/roles";
import { parseSegment, describeSegment } from "@/lib/drip/segment";
import { normalizeWindow, describeWindow } from "@/lib/drip/schedule";
import { trackingStatus } from "@/lib/drip/tracking";
import CampaignsClient, { type CampaignRow } from "./CampaignsClient";

export const metadata = { title: "Drip Campaigns | Admin" };

export default async function CampaignsPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  const now = new Date();
  // This server-rendered lookup intentionally follows the same unbounded,
  // Prisma-backed configuration path as email sends so the status is authoritative.
  const tracking = await trackingStatus();

  const campaigns = await prisma.dripCampaign.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { steps: true } } },
  });

  // One grouped query covers every campaign's enrollment counts.
  const enrollmentGroups = await prisma.dripEnrollment.groupBy({
    by: ["campaignId", "status"],
    _count: { _all: true },
  });

  // DripSend reaches a campaign only through its enrollment, and Prisma cannot
  // group across a relation — so this is a pair of indexed counts per campaign.
  // Bounded by campaign count (a handful), never by send volume.
  const sendCounts = await Promise.all(
    campaigns.map(async (campaign) => {
      const [sent, failed] = await Promise.all([
        prisma.dripSend.count({
          where: { status: "SENT", enrollment: { campaignId: campaign.id } },
        }),
        prisma.dripSend.count({
          where: { status: "FAILED", enrollment: { campaignId: campaign.id } },
        }),
      ]);
      return { campaignId: campaign.id, sent, failed };
    })
  );
  const sendByCampaign = new Map(sendCounts.map((s) => [s.campaignId, s]));

  const countFor = (campaignId: string, status: string) =>
    enrollmentGroups.find((g) => g.campaignId === campaignId && g.status === status)
      ?._count._all ?? 0;

  const rows: CampaignRow[] = campaigns.map((c) => {
    const sends = sendByCampaign.get(c.id) ?? { sent: 0, failed: 0 };
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description ?? null,
      status: c.status,
      priority: c.priority,
      autoEnroll: c.autoEnroll,
      stepCount: c._count.steps,
      segmentLabel: describeSegment(parseSegment(c.segment)),
      windowLabel: describeWindow(normalizeWindow(c)),
      active: countFor(c.id, "ACTIVE"),
      completed: countFor(c.id, "COMPLETED"),
      exited: countFor(c.id, "EXITED"),
      paused: countFor(c.id, "PAUSED"),
      sent: sends.sent,
      failed: sends.failed,
      updatedAt: c.updatedAt.toISOString(),
    };
  });

  // Executive-summary window. All of these are single indexed counts
  // (DripSend has @@index([sentAt])); openedAt/firstClickedAt are the
  // denormalized first-touch rollups, so no EmailEvent scan is involved.
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sent7dWhere = { status: "SENT" as const, sentAt: { gte: sevenDaysAgo } };

  const [dueNow, failedSends, unsubscribed, sent7d, opened7d, clicked7d, newLeads7d] =
    await Promise.all([
      prisma.dripEnrollment.count({
        where: { status: "ACTIVE", nextRunAt: { lte: now } },
      }),
      prisma.dripSend.count({ where: { status: "FAILED" } }),
      prisma.contact.count({ where: { unsubscribedAt: { not: null } } }),
      prisma.dripSend.count({ where: sent7dWhere }),
      prisma.dripSend.count({ where: { ...sent7dWhere, openedAt: { not: null } } }),
      prisma.dripSend.count({ where: { ...sent7dWhere, firstClickedAt: { not: null } } }),
      prisma.contact.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);

  const totalActive = rows.reduce((sum, r) => sum + r.active, 0);
  const activeCampaigns = rows.filter((r) => r.status === "ACTIVE").length;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 z-10 gap-3 shadow-sm">
        <MobileMenuButton />
        <Send className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white">
          Drip Campaigns
        </h1>
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hidden sm:inline-block">
            Total: {rows.length}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          {!tracking.enabled && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
            >
              <p className="font-semibold">Email tracking disabled</p>
              <p className="mt-1">
                Set <code>DRIP_TRACKING_SECRET</code> in{" "}
                <a className="font-semibold underline" href="/admin/integrations">
                  /admin/integrations
                </a>
                . Open and click counts are structurally zero until then.
              </p>
            </div>
          )}
          <CampaignsClient
            campaigns={rows}
            totals={{
              activeEnrollments: totalActive,
              dueNow,
              failedSends,
              unsubscribedContacts: unsubscribed,
            }}
            summary={{
              activeCampaigns,
              activeEnrollments: totalActive,
              dueNow,
              failedSends,
              sent7d,
              opened7d,
              clicked7d,
              newLeads7d,
            }}
          />
        </div>
      </main>
    </div>
  );
}
