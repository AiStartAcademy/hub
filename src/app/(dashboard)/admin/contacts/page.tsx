// src/app/(dashboard)/admin/contacts/page.tsx

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Users, Activity, Send } from "lucide-react";
import Link from "next/link";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import LeadsClient, { type Lead, type DripState } from "./LeadsClient";
import { hasAnyRole } from "@/lib/roles";

export const metadata = { title: "Leads | Admin" };

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function deriveSourceLabel(
  source: string | null,
  firstEvent: { type: string; metadata: string } | undefined
): string {
  if (source === "asset_download") {
    const meta = safeJson<{ fileName?: string }>(firstEvent?.metadata, {});
    return meta.fileName ? `Asset: ${meta.fileName}` : "Asset download";
  }
  if (source?.startsWith("onboarding:")) return `Onboarding: ${source.slice("onboarding:".length)}`;
  if (source === "manual") return "Manual";
  // Fall back to the first event for legacy contacts without a source.
  if (firstEvent) {
    const meta = safeJson<{ fileName?: string; lessonTitle?: string }>(firstEvent.metadata, {});
    if (firstEvent.type === "ASSET_DOWNLOAD") return meta.fileName ? `Asset: ${meta.fileName}` : "Asset download";
    if (firstEvent.type === "LESSON_VIEW") return meta.lessonTitle ? `Lesson: ${meta.lessonTitle}` : "Lesson view";
    if (firstEvent.type === "ONBOARDING") return "Onboarding";
  }
  return "Unknown";
}

type EnrollmentRow = {
  status: string;
  lastStepOrder: number;
  nextRunAt: Date | null;
  campaign: { name: string; slug: string; _count: { steps: number } };
};

/**
 * The one enrollment worth showing in a single table cell.
 *
 * The engine's invariant is that a lead holds at most one ACTIVE enrollment
 * globally (lowest campaign priority wins), so an ACTIVE row is unambiguous and
 * always the most useful thing to show. Otherwise fall back to the most recently
 * updated one — the rows arrive pre-sorted by updatedAt desc.
 */
function pickDripEnrollment(rows: EnrollmentRow[]): DripState | null {
  if (rows.length === 0) return null;
  const chosen = rows.find((r) => r.status === "ACTIVE") ?? rows[0];
  return {
    campaignName: chosen.campaign.name,
    campaignSlug: chosen.campaign.slug,
    status: chosen.status,
    lastStepOrder: chosen.lastStepOrder,
    stepCount: chosen.campaign._count.steps,
    nextRunAt: chosen.nextRunAt ? chosen.nextRunAt.toISOString() : null,
  };
}

export default async function ContactsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ showExcluded?: string | string[] }>;
}) {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  const showExcluded = (await searchParams).showExcluded === "true";
  const contacts = await prisma.contact.findMany({
    where: showExcluded ? undefined : { excludeFromPipeline: false },
    include: {
      _count: { select: { events: true } },
      events: { orderBy: { createdAt: "asc" }, take: 1 },
      // Bounded on purpose: this page loads every contact, so the per-row join
      // must stay a small constant. Three is enough to pick the enrollment we
      // show (see pickDripEnrollment) without dragging a lead's whole history.
      dripEnrollments: {
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
          status: true,
          lastStepOrder: true,
          nextRunAt: true,
          campaign: {
            select: { name: true, slug: true, _count: { select: { steps: true } } },
          },
        },
      },
    },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
  });

  const leads: Lead[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone ?? null,
    userId: c.userId ?? null,
    status: c.status ?? "NEW",
    excludeFromPipeline: c.excludeFromPipeline,
    source: c.source ?? null,
    sourceLabel: deriveSourceLabel(c.source ?? null, c.events[0]),
    attribution: safeJson<Record<string, string>>(c.attribution, {}),
    tags: safeJson<string[]>(c.tags, []),
    notes: c.notes ?? null,
    createdAt: c.createdAt.toISOString(),
    lastActivityAt: c.lastActivityAt ? c.lastActivityAt.toISOString() : null,
    unsubscribedAt: c.unsubscribedAt ? c.unsubscribedAt.toISOString() : null,
    eventCount: c._count.events,
    drip: pickDripEnrollment(c.dripEnrollments),
  }));

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 z-10 gap-3 shadow-sm">
        <MobileMenuButton />
        <Users className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white">Leads Database</h1>
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <Link
            href="/admin/contacts/campaigns"
            className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-primary transition-colors bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm min-h-[44px]"
          >
            <Send className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">Campaigns</span>
          </Link>
          <Link
            href="/admin/contacts/activity"
            className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-primary transition-colors bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm min-h-[44px]"
          >
            <Activity className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">View Activity Log</span>
          </Link>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hidden sm:inline-block">
            Total: {leads.length}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <LeadsClient
            key={showExcluded ? "all-contacts" : "pipeline-contacts"}
            leads={leads}
          />
        </div>
      </main>
    </div>
  );
}
