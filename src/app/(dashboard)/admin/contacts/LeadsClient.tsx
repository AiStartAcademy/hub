"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Mail, Phone, Search, Download, StickyNote, X, Loader2, BellOff,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "./leadStatus";
import { updateLeadStatus, updateLeadNotes } from "./actions";
import {
  LEAD_LIST_DRIP_FILTERS,
  parseLeadListParams,
  serializeLeadListParams,
  type LeadListSort,
  type LeadListSortKey,
} from "./leadListParams";

/** A lead's position in a drip campaign — the enrollment we chose to surface. */
export interface DripState {
  campaignName: string;
  campaignSlug: string;
  /** ACTIVE | COMPLETED | EXITED | PAUSED */
  status: string;
  /** Steps actually sent so far. */
  lastStepOrder: number;
  /** Total steps in the campaign. */
  stepCount: number;
  nextRunAt: string | null;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  userId: string | null;
  status: string;
  excludeFromPipeline: boolean;
  source: string | null;
  sourceLabel: string;
  attribution: Record<string, string>;
  tags: string[];
  notes: string | null;
  createdAt: string;
  lastActivityAt: string | null;
  /** Set once the lead used an unsubscribe link — they are suppressed from all drip mail. */
  unsubscribedAt: string | null;
  eventCount: number;
  /** Drip campaign position. Null when the lead was never enrolled. */
  drip: DripState | null;
}

const STATUS_STYLE: Record<string, string> = {
  NEW: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  CONTACTED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  QUALIFIED: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  WON: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  LOST: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

const DRIP_STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  COMPLETED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  EXITED: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function csvEscape(v: string) {
  const safeValue = /^[\t\r ]*[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}

export default function LeadsClient({ leads }: { leads: Lead[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Lead[]>(leads);
  const [notesFor, setNotesFor] = useState<Lead | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSavingIds, setStatusSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const mountedRef = useRef(true);
  const statusRequestIdRef = useRef(0);
  const statusRequestByLeadRef = useRef(new Map<string, number>());
  const statusInFlightRef = useRef(new Set<string>());

  useEffect(() => {
    const requestByLead = statusRequestByLeadRef.current;
    const inFlight = statusInFlightRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      statusRequestIdRef.current += 1;
      requestByLead.clear();
      inFlight.clear();
    };
  }, []);

  const sources = useMemo(
    () => Array.from(new Set(rows.map((l) => l.source).filter(Boolean))) as string[],
    [rows]
  );

  const campaignNames = useMemo(
    () => Array.from(new Set(rows.map((l) => l.drip?.campaignName).filter(Boolean))).sort() as string[],
    [rows]
  );

  const allTags = useMemo(
    () => Array.from(new Set(rows.flatMap((l) => l.tags))).sort(),
    [rows]
  );

  const urlState = useMemo(
    () => parseLeadListParams(searchParams, { sources, campaignNames, tags: allTags }),
    [searchParams, sources, campaignNames, allTags]
  );
  const {
    statusFilter,
    sourceFilter,
    dripFilter,
    tagFilter,
    sort,
    showExcluded,
  } = urlState;
  const [searchDraft, setSearchDraft] = useState(() => ({
    urlValue: urlState.search,
    inputValue: urlState.search,
  }));
  if (searchDraft.urlValue !== urlState.search) {
    setSearchDraft({ urlValue: urlState.search, inputValue: urlState.search });
  }
  const search = searchDraft.urlValue === urlState.search
    ? searchDraft.inputValue
    : urlState.search;

  const replaceUrlState = useCallback((nextState: typeof urlState) => {
    const nextParams = serializeLeadListParams(nextState, searchParams);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (search === urlState.search) return;
    const timer = window.setTimeout(() => {
      replaceUrlState({ ...urlState, search });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [replaceUrlState, search, urlState]);

  /** Sortable value per column. Nulls sort last in both directions. */
  function sortValue(l: Lead, key: LeadListSortKey): string | number | null {
    switch (key) {
      case "name": return (l.name || l.email).toLowerCase();
      case "status": return LEAD_STATUSES.indexOf(l.status as LeadStatus);
      case "source": return l.sourceLabel.toLowerCase();
      case "adCampaign": return l.attribution?.utm_campaign?.toLowerCase() ?? null;
      // Group by campaign, then order by how far through it the lead is.
      case "drip": return l.drip ? `${l.drip.campaignName} ${String(l.drip.lastStepOrder).padStart(4, "0")}` : null;
      case "tags": return l.tags.length;
      case "added": return new Date(l.createdAt).getTime();
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((l) => {
      if (!showExcluded && l.excludeFromPipeline) return false;
      if (statusFilter !== "ALL" && l.status !== statusFilter) return false;
      if (sourceFilter !== "ALL" && l.source !== sourceFilter) return false;
      if (dripFilter !== "ALL") {
        if (dripFilter === "NONE") {
          if (l.drip) return false;
        } else if ((LEAD_LIST_DRIP_FILTERS as readonly string[]).includes(dripFilter)) {
          if (l.drip?.status !== dripFilter) return false;
        } else if (l.drip?.campaignName !== dripFilter) {
          return false;
        }
      }
      // Multi-select tags are AND-ed: each selected tag must be present.
      if (tagFilter.length && !tagFilter.every((t) => l.tags.includes(t))) return false;
      if (q && !(`${l.name} ${l.email} ${l.phone ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });

    // No sort selected = server order (lastActivityAt desc), which is the most
    // useful default. Sorting copies first so `rows` order is never mutated.
    if (!sort) return out;
    return [...out].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -sort.dir;
      if (av > bv) return sort.dir;
      return 0;
    });
  }, [rows, search, statusFilter, sourceFilter, dripFilter, tagFilter, sort, showExcluded]);

  /** Header click cycles asc → desc → unsorted. */
  function toggleSort(key: LeadListSortKey) {
    let nextSort: LeadListSort | null;
    if (sort?.key !== key) nextSort = { key, dir: 1 };
    else if (sort.dir === 1) nextSort = { key, dir: -1 };
    else nextSort = null;
    replaceUrlState({ ...urlState, sort: nextSort });
  }

  function toggleTag(tag: string) {
    const nextTags = tagFilter.includes(tag)
      ? tagFilter.filter((currentTag) => currentTag !== tag)
      : [...tagFilter, tag];
    replaceUrlState({ ...urlState, tagFilter: nextTags });
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of rows) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [rows]);

  function changeStatus(lead: Lead, status: LeadStatus) {
    if (statusInFlightRef.current.has(lead.id) || status === lead.status) return;
    const priorStatus = lead.status as LeadStatus;
    const requestId = ++statusRequestIdRef.current;
    statusRequestByLeadRef.current.set(lead.id, requestId);
    statusInFlightRef.current.add(lead.id);
    setRows((rs) => rs.map((r) => (r.id === lead.id ? { ...r, status } : r)));
    setStatusSavingIds((current) => new Set(current).add(lead.id));
    startTransition(async () => {
      try {
        const result = await updateLeadStatus(lead.id, status, priorStatus);
        if (!mountedRef.current || statusRequestByLeadRef.current.get(lead.id) !== requestId) return;
        if (!result.ok) {
          setRows((rs) => rs.map((r) => (
            r.id === lead.id ? { ...r, status: priorStatus } : r
          )));
          setStatusError(
            `Could not update ${lead.name || lead.email}: status changed in another tab. The latest server value is being loaded.`
          );
        } else {
          setStatusError(null);
        }
        router.refresh();
      } catch (error: unknown) {
        if (!mountedRef.current || statusRequestByLeadRef.current.get(lead.id) !== requestId) return;
        setRows((rs) => rs.map((r) => (
          r.id === lead.id ? { ...r, status: priorStatus } : r
        )));
        const reason = error instanceof Error ? error.message : "Could not update lead status";
        setStatusError(`Could not update ${lead.name || lead.email}: ${reason}`);
        router.refresh();
      } finally {
        if (mountedRef.current && statusRequestByLeadRef.current.get(lead.id) === requestId) {
          statusRequestByLeadRef.current.delete(lead.id);
          statusInFlightRef.current.delete(lead.id);
          setStatusSavingIds((current) => {
            const next = new Set(current);
            next.delete(lead.id);
            return next;
          });
        }
      }
    });
  }

  function exportCSV() {
    const headers = [
      "Name", "Email", "Phone", "Status", "Source",
      "UTM Source", "UTM Medium", "UTM Campaign", "UTM Content", "Click ID",
      "Drip Campaign", "Drip Status", "Drip Step", "Drip Next Run",
      "Tags", "Notes", "Added", "Last Activity", "Unsubscribed", "Excluded from Pipeline",
    ];
    const lines = filtered.map((l) => {
      const a = l.attribution || {};
      const clickId = a.fbclid || a.gclid || a.ttclid || a.li_fat_id || a.msclkid || a.twclid || "";
      return [
        l.name, l.email, l.phone ?? "", l.status, l.source ?? "",
        a.utm_source ?? "", a.utm_medium ?? "", a.utm_campaign ?? "", a.utm_content ?? "", clickId,
        l.drip?.campaignName ?? "", l.drip?.status ?? "",
        l.drip ? `${l.drip.lastStepOrder}/${l.drip.stepCount}` : "",
        l.drip?.nextRunAt ? fmtDate(l.drip.nextRunAt) : "",
        l.tags.join(" | "), l.notes ?? "", fmtDate(l.createdAt), fmtDate(l.lastActivityAt),
        l.unsubscribedAt ? fmtDate(l.unsubscribedAt) : "", l.excludeFromPipeline ? "yes" : "no",
      ].map((v) => csvEscape(String(v))).join(",");
    });
    const csv = "﻿" + [headers.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearchDraft({ urlValue: urlState.search, inputValue: e.target.value })}
            placeholder="Search name, email, phone…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <select value={statusFilter} onChange={(e) => replaceUrlState({ ...urlState, statusFilter: e.target.value })}
          className="px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg">
          <option value="ALL">All statuses ({rows.length})</option>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s} ({counts[s] ?? 0})</option>)}
        </select>
        <select value={sourceFilter} onChange={(e) => replaceUrlState({ ...urlState, sourceFilter: e.target.value })}
          className="px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg max-w-[200px]">
          <option value="ALL">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={dripFilter} onChange={(e) => replaceUrlState({ ...urlState, dripFilter: e.target.value })}
          className="px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg max-w-[220px]">
          <option value="ALL">All drip states</option>
          <option value="NONE">Not in a campaign</option>
          {LEAD_LIST_DRIP_FILTERS.filter((f) => f !== "NONE").map((f) => (
            <option key={f} value={f}>{f.charAt(0) + f.slice(1).toLowerCase()}</option>
          ))}
          {campaignNames.length > 0 && (
            <optgroup label="Campaign">
              {campaignNames.map((c) => <option key={c} value={c}>{c}</option>)}
            </optgroup>
          )}
        </select>
        <label className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(event) =>
              replaceUrlState({ ...urlState, showExcluded: event.target.checked })
            }
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
          />
          Show excluded
        </label>
        <button onClick={exportCSV}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
          <Download className="h-4 w-4" /> Export CSV ({filtered.length})
        </button>
      </div>

      {statusError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
        >
          <span>{statusError}</span>
          <button
            type="button"
            onClick={() => setStatusError(null)}
            aria-label="Dismiss status update error"
            className="shrink-0 rounded p-0.5 hover:bg-rose-100 dark:hover:bg-rose-900/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tag filter — AND-ed, so each added tag narrows further */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest font-black text-slate-400 mr-1">Tags</span>
          {allTags.map((t) => {
            const on = tagFilter.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                aria-pressed={on}
                className={`text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                  on
                    ? "bg-primary text-white border-primary"
                    : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 hover:border-primary/50"
                }`}
              >
                {t}
              </button>
            );
          })}
          {tagFilter.length > 0 && (
            <button onClick={() => replaceUrlState({ ...urlState, tagFilter: [] })}
              className="text-[11px] font-semibold px-2 py-1 text-slate-400 hover:text-slate-600 underline">
              clear
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase tracking-widest font-black text-slate-400">
              <tr>
                <SortHeader label="Lead" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                <SortHeader label="Source" sortKey="source" sort={sort} onSort={toggleSort} />
                <SortHeader
                  label="Ad Campaign"
                  sortKey="adCampaign"
                  sort={sort}
                  onSort={toggleSort}
                  title="First-touch UTM attribution — which ad brought this lead in. Not a drip campaign."
                />
                <SortHeader
                  label="Drip"
                  sortKey="drip"
                  sort={sort}
                  onSort={toggleSort}
                  title="Drip campaign enrollment: which sequence this lead is in and how far through it."
                />
                <SortHeader label="Tags" sortKey="tags" sort={sort} onSort={toggleSort} />
                <SortHeader label="Added" sortKey="added" sort={sort} onSort={toggleSort} />
                <th className="px-4 py-3 text-right">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {filtered.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Link href={`/admin/contacts/${l.id}`} className="hover:text-primary hover:underline">
                        {l.name || l.email}
                      </Link>
                      {l.unsubscribedAt && (
                        <span
                          title={`Unsubscribed ${fmtDate(l.unsubscribedAt)} — suppressed from all drip mail`}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase tracking-wide"
                        >
                          <BellOff className="h-2.5 w-2.5" />unsubscribed
                        </span>
                      )}
                      {l.userId && (
                        <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 uppercase tracking-wide">
                          Has account
                        </span>
                      )}
                      {l.excludeFromPipeline && (
                        <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                          Excluded
                        </span>
                      )}
                    </p>
                    <a href={`mailto:${l.email}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary">
                      <Mail className="h-3 w-3" />{l.email}
                    </a>
                    {l.phone && (
                      <a href={`tel:${l.phone}`} className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary">
                        <Phone className="h-3 w-3" />{l.phone}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={l.status}
                      onChange={(e) => changeStatus(l, e.target.value as LeadStatus)}
                      disabled={statusSavingIds.has(l.id)}
                      className={`text-xs font-bold px-2 py-1 rounded-full border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/30 ${STATUS_STYLE[l.status] ?? "bg-slate-100 text-slate-600"}`}
                    >
                      {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 max-w-[180px] truncate" title={l.sourceLabel}>
                    {l.sourceLabel}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {l.attribution?.utm_campaign ? (
                      <div>
                        <span className="font-semibold">{l.attribution.utm_campaign}</span>
                        <span className="block text-[11px] text-slate-400">
                          {[l.attribution.utm_source, l.attribution.utm_medium].filter(Boolean).join(" / ")}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {l.drip ? (
                      <div className="max-w-[190px]">
                        <span
                          className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                            DRIP_STATUS_STYLE[l.drip.status] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {l.drip.status}
                        </span>
                        <span className="block font-semibold text-slate-700 dark:text-slate-200 truncate" title={l.drip.campaignName}>
                          {l.drip.campaignName}
                        </span>
                        <span className="block text-[11px] text-slate-400">
                          step {l.drip.lastStepOrder}/{l.drip.stepCount}
                          {l.drip.status === "ACTIVE" && l.drip.nextRunAt && (
                            <> · next {fmtDate(l.drip.nextRunAt)}</>
                          )}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                      {l.tags.slice(0, 4).map((t) => (
                        <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{t}</span>
                      ))}
                      {l.tags.length === 0 && <span className="text-slate-400 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(l.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setNotesFor(l)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${l.notes ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200"}`}
                    >
                      <StickyNote className="h-3 w-3" />{l.notes ? "Notes" : "Add"}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No leads match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pending && (
        <p className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</p>
      )}

      {notesFor && (
        <NotesModal
          lead={notesFor}
          onClose={() => setNotesFor(null)}
          onSave={(notes) => {
            setRows((rs) => rs.map((r) => (r.id === notesFor.id ? { ...r, notes } : r)));
            startTransition(() => {
              updateLeadNotes(notesFor.id, notes).catch((error: unknown) => {
                console.error("Failed to update lead notes", error);
              });
            });
            setNotesFor(null);
          }}
        />
      )}
    </div>
  );
}

/** Clickable column header. Cycles asc → desc → unsorted; shows which state it's in. */
function SortHeader({
  label, sortKey, sort, onSort, title,
}: {
  label: string;
  sortKey: LeadListSortKey;
  sort: LeadListSort | null;
  onSort: (key: LeadListSortKey) => void;
  title?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 1 ? ChevronUp : ChevronDown;
  return (
    <th className="px-4 py-3" title={title} aria-sort={!active ? "none" : sort.dir === 1 ? "ascending" : "descending"}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-widest font-black transition-colors ${
          active ? "text-primary" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        }`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function NotesModal({ lead, onClose, onSave }: { lead: Lead; onClose: () => void; onSave: (notes: string) => void }) {
  const [draft, setDraft] = useState(lead.notes ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-900 dark:text-white">Notes — {lead.name || lead.email}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          autoFocus
          placeholder="Follow-up notes, call summary, next steps…"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
          <button onClick={() => onSave(draft)} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90">Save</button>
        </div>
      </div>
    </div>
  );
}
