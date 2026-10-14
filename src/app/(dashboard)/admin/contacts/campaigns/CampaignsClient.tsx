"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Play,
  Loader2,
  AlertTriangle,
  Users,
  Clock,
  MailX,
  BellOff,
  ChevronRight,
  Send,
} from "lucide-react";
import { CAMPAIGN_STATUSES } from "@/lib/drip/constants";
import { createCampaign, setCampaignStatus, runTickNow } from "./actions";

export interface CampaignRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  priority: number;
  autoEnroll: boolean;
  stepCount: number;
  segmentLabel: string;
  windowLabel: string;
  active: number;
  completed: number;
  exited: number;
  paused: number;
  sent: number;
  failed: number;
  updatedAt: string;
}

export interface CampaignTotals {
  activeEnrollments: number;
  dueNow: number;
  failedSends: number;
  unsubscribedContacts: number;
}

/** Birds-eye numbers for the executive summary. 7d fields are counted over
 *  DripSend.sentAt ≥ now-7d; opens are MPP-inflated (directional only), clicks
 *  are the trustworthy engagement signal. */
export interface CampaignSummary {
  activeCampaigns: number;
  activeEnrollments: number;
  dueNow: number;
  failedSends: number;
  sent7d: number;
  opened7d: number;
  clicked7d: number;
  newLeads7d: number;
}

/** Shape of what `runTickNow()` hands back, kept local so props stay serialisable. */
type TickSummary = {
  enrolled: number;
  sent: number;
  tasks: number;
  deferred: number;
  failed: number;
  exited: number;
  completed: number;
  errors: string[];
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  ARCHIVED: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export default function CampaignsClient({
  campaigns,
  totals,
  summary,
}: {
  campaigns: CampaignRow[];
  totals: CampaignTotals;
  summary: CampaignSummary;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Errors are keyed by campaign id so a failure lands next to the control that caused it.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [tickResult, setTickResult] = useState<TickSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  // Client-side status filter, same pattern as LeadsClient. "ALL" shows everything.
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of campaigns) counts[c.status] = (counts[c.status] ?? 0) + 1;
    return counts;
  }, [campaigns]);

  const visible = useMemo(
    () => (statusFilter === "ALL" ? campaigns : campaigns.filter((c) => c.status === statusFilter)),
    [campaigns, statusFilter]
  );

  function changeStatus(campaign: CampaignRow, status: string) {
    setErrors((e) => ({ ...e, [campaign.id]: "" }));
    startTransition(async () => {
      try {
        await setCampaignStatus(campaign.id, status);
        router.refresh();
      } catch (error) {
        // Activating a campaign with zero steps throws by design — show why.
        setErrors((e) => ({ ...e, [campaign.id]: errorMessage(error) }));
      }
    });
  }

  function create() {
    const name = newName.trim();
    if (!name) {
      setGlobalError("Give the campaign a name first.");
      return;
    }
    setGlobalError(null);
    startTransition(async () => {
      try {
        const id = await createCampaign(name);
        setNewName("");
        setCreating(false);
        router.push(`/admin/contacts/campaigns/${id}`);
      } catch (error) {
        setGlobalError(errorMessage(error));
      }
    });
  }

  function runNow() {
    setGlobalError(null);
    setTickResult(null);
    startTransition(async () => {
      try {
        const result = await runTickNow();
        setTickResult(result);
        router.refresh();
      } catch (error) {
        setGlobalError(errorMessage(error));
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Executive summary — the birds-eye read before any card */}
      <ExecutiveSummary summary={summary} />

      {/* Header stats (global across all campaigns, regardless of the filter) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active enrollments" value={totals.activeEnrollments} Icon={Users} />
        <StatCard label="Due now" value={totals.dueNow} Icon={Clock} />
        <StatCard
          label="Failed sends"
          value={totals.failedSends}
          Icon={MailX}
          alert={totals.failedSends > 0}
        />
        <StatCard label="Unsubscribed" value={totals.unsubscribedContacts} Icon={BellOff} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {creating ? (
          <>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              autoFocus
              placeholder="Campaign name…"
              className="flex-1 min-w-[200px] px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[44px]"
            />
            <button
              onClick={create}
              disabled={pending}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewName("");
                setGlobalError(null);
              }}
              className="px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg min-h-[44px]"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors min-h-[44px]"
          >
            <Plus className="h-4 w-4" /> New campaign
          </button>
        )}

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter campaigns by status"
          className="px-3 py-2 text-sm font-semibold bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[44px] ml-auto"
        >
          <option value="ALL">All statuses ({campaigns.length})</option>
          {CAMPAIGN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s} ({statusCounts[s] ?? 0})
            </option>
          ))}
        </select>

        <button
          onClick={runNow}
          disabled={pending}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run now
        </button>
      </div>

      {globalError && <ErrorBanner message={globalError} />}

      {tickResult && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">
            Last run
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span>enrolled <strong>{tickResult.enrolled}</strong></span>
            <span>sent <strong>{tickResult.sent}</strong></span>
            <span>tasks <strong>{tickResult.tasks}</strong></span>
            <span>deferred <strong>{tickResult.deferred}</strong></span>
            <span>failed <strong>{tickResult.failed}</strong></span>
            <span>exited <strong>{tickResult.exited}</strong></span>
            <span>completed <strong>{tickResult.completed}</strong></span>
          </div>
          {tickResult.errors.length > 0 && (
            <ul className="text-xs text-rose-600 dark:text-rose-400 space-y-0.5 pt-1">
              {tickResult.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Campaign cards */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm border-dashed">
          <Send className="h-12 w-12 mb-4 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-bold uppercase tracking-widest text-slate-400">
            {campaigns.length === 0 ? "No campaigns yet" : `No ${statusFilter.toLowerCase()} campaigns`}
          </p>
          <p className="text-xs mt-1 text-slate-500">
            {campaigns.length === 0
              ? "Create one, or run the drip seeder to install the starter sequences."
              : "Switch the status filter to see the rest."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <div
              key={c.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 md:p-5"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/admin/contacts/campaigns/${c.id}`}
                      className="font-bold text-slate-900 dark:text-white hover:text-primary transition-colors"
                    >
                      {c.name}
                    </Link>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${STATUS_STYLE[c.status] ?? STATUS_STYLE.DRAFT}`}
                    >
                      {c.status}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                      priority {c.priority}
                    </span>
                    {!c.autoEnroll && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        manual only
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{c.slug}</p>
                  {c.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                      {c.description}
                    </p>
                  )}
                  <dl className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <div>
                      <dt className="inline font-semibold text-slate-400">Audience: </dt>
                      <dd className="inline">{c.segmentLabel}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-slate-400">Window: </dt>
                      <dd className="inline">{c.windowLabel}</dd>
                    </div>
                  </dl>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={c.status}
                    onChange={(e) => changeStatus(c, e.target.value)}
                    disabled={pending}
                    aria-label={`Status for ${c.name}`}
                    className="text-xs font-bold px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 min-h-[44px]"
                  >
                    {CAMPAIGN_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <Link
                    href={`/admin/contacts/campaigns/${c.id}`}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-slate-500 hover:text-primary bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors min-h-[44px]"
                  >
                    Edit <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <Metric label="steps" value={c.stepCount} />
                <Metric label="active" value={c.active} />
                <Metric label="completed" value={c.completed} />
                <Metric label="exited" value={c.exited} />
                <Metric label="paused" value={c.paused} />
                <Metric label="sent" value={c.sent} />
                <Metric label="failed" value={c.failed} alert={c.failed > 0} />
              </div>

              {errors[c.id] && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  {errors[c.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutiveSummary({ summary }: { summary: CampaignSummary }) {
  const s = summary;
  const clickRate = s.sent7d > 0 ? Math.round((s.clicked7d / s.sent7d) * 100) : 0;
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 md:p-5">
      <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">
        This week at a glance
      </p>
      <p className="mt-2 text-sm md:text-base text-slate-700 dark:text-slate-200 leading-relaxed">
        <Big>{s.activeCampaigns}</Big> active {s.activeCampaigns === 1 ? "campaign is" : "campaigns are"}{" "}
        nurturing <Big>{s.activeEnrollments}</Big> {s.activeEnrollments === 1 ? "lead" : "leads"}.{" "}
        <Big>{s.sent7d}</Big> {s.sent7d === 1 ? "email" : "emails"} went out in the last 7 days
        {s.sent7d > 0 && (
          <>
            {" "}— <Big>{s.clicked7d}</Big> clicked ({clickRate}%), ~{s.opened7d} opened
          </>
        )}
        . <Big>{s.newLeads7d}</Big> new {s.newLeads7d === 1 ? "lead" : "leads"} came in this week
        {s.dueNow > 0 && (
          <>
            , and <Big>{s.dueNow}</Big> {s.dueNow === 1 ? "email is" : "emails are"} due to send now
          </>
        )}
        .{" "}
        {s.failedSends > 0 ? (
          <span className="text-rose-600 dark:text-rose-400 font-semibold">
            {s.failedSends} failed {s.failedSends === 1 ? "send needs" : "sends need"} attention.
          </span>
        ) : (
          <span className="text-slate-400">No failures.</span>
        )}
      </p>
      <p className="mt-2 text-[11px] text-slate-400">
        Opens are directional (Apple Mail inflates them) — trust clicks.
      </p>
    </div>
  );
}

function Big({ children }: { children: ReactNode }) {
  return <strong className="text-slate-900 dark:text-white">{children}</strong>;
}

function Metric({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <span className={alert ? "text-rose-600 dark:text-rose-400" : undefined}>
      {label} <strong>{value}</strong>
    </span>
  );
}

function StatCard({
  label,
  value,
  Icon,
  alert = false,
}: {
  label: string;
  value: number;
  Icon: typeof Users;
  alert?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        <p className="text-[10px] uppercase tracking-widest font-black">{label}</p>
      </div>
      <p
        className={`text-2xl font-bold mt-1 ${alert ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white"}`}
      >
        {value}
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900 rounded-lg px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      {message}
    </p>
  );
}
