"use client";

// Sessions panel for the cohort edit page: previews the Zoom-derived schedule,
// allows quick title/description edits, and lets a manager set the join link
// per session — a custom URL, or one borrowed from another cohort's session
// (the server resolves the borrowed URL; the client only sends the source id).
// Zoom owns date/time/status, so those are read-only here.

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, RefreshCw, Check, X, Pencil, AlertCircle, Video, Link2, Copy,
} from "lucide-react";
import { sessionWhenLines, viewerTimezone } from "@/lib/sessionTime";

export interface CohortSessionRow {
  id: string;
  title: string;
  description: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  status: string;
  meetingLink: string | null;
  recordingLink: string | null;
  zoomOccurrenceId: string | null;
  linkedSessionId: string | null;
  /** Source cohort of a borrowed link; the server includes it on GET and PATCH. */
  linkedSession?: { cohort: { id: string; title: string } | null } | null;
}

/** `GET /api/admin/cohorts/list` row. */
export interface CohortListItem {
  id: string;
  title: string;
  status: string;
}

export type SessionLinkChip = {
  label: "Custom link" | `From ${string}` | "Linked" | "Cohort link" | "No link";
  url: string | null;
};

/**
 * Where a session's join link comes from. Precedence: an own `meetingLink`
 * without a source is custom; with a source it is borrowed ("From <title>",
 * or "Linked" when the source cohort isn't in the loaded list); otherwise the
 * cohort's Zoom link; otherwise nothing.
 */
export function sessionLinkChip({
  meetingLink, linkedSessionId, cohortZoomLink, sourceCohortTitle,
}: {
  meetingLink: string | null;
  linkedSessionId: string | null;
  cohortZoomLink: string | null;
  sourceCohortTitle: string | null;
}): SessionLinkChip {
  if (meetingLink) {
    if (linkedSessionId) {
      return sourceCohortTitle
        ? { label: `From ${sourceCohortTitle}`, url: meetingLink }
        : { label: "Linked", url: meetingLink };
    }
    return { label: "Custom link", url: meetingLink };
  }
  if (cohortZoomLink) return { label: "Cohort link", url: cohortZoomLink };
  return { label: "No link", url: null };
}

/** The row whose `startTime` is the same instant as `targetStartTime`, else null. */
export function matchSessionByInstant<T extends { startTime: string | null }>(
  rows: T[],
  targetStartTime: string | null
): T | null {
  if (!targetStartTime) return null;
  const target = new Date(targetStartTime).getTime();
  if (Number.isNaN(target)) return null;
  return rows.find((r) => r.startTime && new Date(r.startTime).getTime() === target) ?? null;
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

const STATUS_STYLES: Record<string, string> = {
  upcoming: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  live: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  completed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const truncateUrl = (url: string, max = 44) =>
  url.length <= max ? url : `${url.slice(0, max - 1)}…`;

export function SessionsPanel({ cohortId, zoomLink }: { cohortId: string; zoomLink: string }) {
  const [sessions, setSessions] = useState<CohortSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewerTz, setViewerTz] = useState<string | null>(null);
  // Other cohorts, for the "From <title>" chip and the link picker. Loaded
  // lazily: on mount only when some row borrows a link, else on first picker open.
  const [cohortList, setCohortList] = useState<CohortListItem[] | null>(null);
  // The route param may be the slug; the list endpoint speaks ids, so remember
  // this cohort's id from the GET to keep it out of the "another cohort" picker.
  const [cohortDbId, setCohortDbId] = useState<string | null>(null);
  const [cohortListError, setCohortListError] = useState<string | null>(null);
  // Which cohort each borrowed session came from (sessionId → cohortId), filled
  // as source cohorts get loaded, so the chip can name the source.
  const [sourceCohortBySession, setSourceCohortBySession] = useState<Record<string, string>>({});

  useEffect(() => setViewerTz(viewerTimezone()), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cohorts/${cohortId}`);
      if (!res.ok) throw new Error("Failed to load sessions");
      const data = await res.json();
      if (typeof data.id === "string") setCohortDbId(data.id);
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [cohortId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadCohortList = useCallback(async (): Promise<CohortListItem[]> => {
    if (cohortList) return cohortList;
    try {
      const res = await fetch("/api/admin/cohorts/list");
      if (!res.ok) throw new Error("Failed to load cohorts");
      const data = await res.json();
      const rows: CohortListItem[] = (Array.isArray(data) ? data : data.cohorts || [])
        .filter((c: CohortListItem) => c.id !== cohortId && c.id !== cohortDbId);
      setCohortList(rows);
      setCohortListError(null);
      return rows;
    } catch (err) {
      setCohortListError(err instanceof Error ? err.message : "Failed to load cohorts");
      return [];
    }
  }, [cohortId, cohortDbId, cohortList]);

  const syncFromZoom = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/sessions/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSessions(data.sessions || []);
      setNotice(`Synced ${data.synced} session${data.synced === 1 ? "" : "s"} from Zoom.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const applyEdit = (updated: CohortSessionRow, sourceCohortId?: string) => {
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
    if (updated.linkedSessionId && sourceCohortId) {
      setSourceCohortBySession((prev) => ({ ...prev, [updated.linkedSessionId as string]: sourceCohortId }));
    }
  };

  const sourceTitleFor = (s: CohortSessionRow): string | null => {
    if (!s.linkedSessionId) return null;
    if (s.linkedSession?.cohort?.title) return s.linkedSession.cohort.title;
    const cid = sourceCohortBySession[s.linkedSessionId];
    return (cid && cohortList?.find((c) => c.id === cid)?.title) || null;
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-4 mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Sessions</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dates and times come from Zoom; join links can be set per session.
          </p>
        </div>
        <button
          type="button"
          onClick={syncFromZoom}
          disabled={syncing || !zoomLink}
          title={!zoomLink ? "Add a Zoom link first" : "Pull the latest schedule from Zoom"}
          className="shrink-0 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? "Syncing..." : "Sync from Zoom"}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions...
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No sessions yet.{" "}
          {zoomLink
            ? "Hit “Sync from Zoom” to pull the schedule."
            : "Add a Zoom link above and save, then sync."}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {sessions.map((s, i) => (
            <SessionRow
              key={s.id}
              n={i + 1}
              session={s}
              cohortId={cohortId}
              cohortZoomLink={zoomLink || null}
              sourceCohortTitle={sourceTitleFor(s)}
              viewerTz={viewerTz}
              onSaved={applyEdit}
              loadCohortList={loadCohortList}
              cohortListError={cohortListError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionRow({
  n, session, cohortId, cohortZoomLink, sourceCohortTitle, viewerTz, onSaved, loadCohortList, cohortListError,
}: {
  n: number;
  session: CohortSessionRow;
  cohortId: string;
  cohortZoomLink: string | null;
  sourceCohortTitle: string | null;
  viewerTz: string | null;
  onSaved: (s: CohortSessionRow, sourceCohortId?: string) => void;
  loadCohortList: () => Promise<CohortListItem[]>;
  cohortListError: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [description, setDescription] = useState(session.description ?? "");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { main, viewer } = sessionWhenLines(session.startTime, session.timezone, viewerTz);
  const chip = sessionLinkChip({
    meetingLink: session.meetingLink,
    linkedSessionId: session.linkedSessionId,
    cohortZoomLink,
    sourceCohortTitle,
  });

  const save = async () => {
    setSaving(true);
    setRowError(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      onSaved(data.session);
      setEditing(false);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setTitle(session.title);
    setDescription(session.description ?? "");
    setRowError(null);
    setEditing(false);
  };

  const copyLink = async () => {
    if (!chip.url) return;
    try {
      await navigator.clipboard.writeText(chip.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setRowError("Could not copy — select the link and copy it manually.");
    }
  };

  return (
    <li className="py-3.5 flex gap-4">
      <span className="shrink-0 w-6 pt-0.5 font-mono text-xs text-slate-400">{n}</span>

      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-900 dark:text-white tabular-nums">
          {main ?? <span className="text-slate-400">Not scheduled</span>}
        </div>
        {viewer && (
          <div className="text-xs text-slate-500 dark:text-slate-400">Your time: {viewer}</div>
        )}

        {editing ? (
          <div className="mt-2.5 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Session title"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Description (e.g. Free Q&A session)"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            />
            {rowError && <p className="text-xs text-red-600 dark:text-red-400">{rowError}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="text-slate-500 dark:text-slate-400">{session.title}</span>
            {session.description && (
              <span className="block text-xs text-slate-400 mt-0.5 line-clamp-2">{session.description}</span>
            )}
          </div>
        )}

        {/* Join-link chip */}
        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
              chip.url
                ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            }`}
            data-testid="session-link-chip"
          >
            <Link2 className="h-3 w-3" /> {chip.label}
          </span>
          {chip.url && (
            <>
              <a
                href={chip.url}
                target="_blank"
                rel="noreferrer"
                title={chip.url}
                className="font-mono text-slate-500 dark:text-slate-400 hover:text-primary truncate max-w-[22rem]"
              >
                {truncateUrl(chip.url)}
              </a>
              <button
                type="button"
                onClick={copyLink}
                title="Copy link"
                className="p-1 rounded text-slate-400 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
          {!linking && (
            <button
              type="button"
              onClick={() => { setLinking(true); setRowError(null); }}
              className="text-primary hover:underline font-medium"
            >
              Set link
            </button>
          )}
        </div>
        {!editing && rowError && !linking && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{rowError}</p>
        )}

        {linking && (
          <LinkPicker
            cohortId={cohortId}
            session={session}
            viewerTz={viewerTz}
            loadCohortList={loadCohortList}
            cohortListError={cohortListError}
            onSaved={(s, sourceCohortId) => { onSaved(s, sourceCohortId); setLinking(false); }}
            onClose={() => setLinking(false)}
          />
        )}
      </div>

      <div className="shrink-0 flex items-start gap-2">
        {session.recordingLink && (
          <a
            href={session.recordingLink}
            target="_blank"
            rel="noreferrer"
            title="Recording"
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Video className="h-4 w-4" />
          </a>
        )}
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${
            STATUS_STYLES[session.status] ?? STATUS_STYLES.completed
          }`}
        >
          {session.status}
        </span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit title & description"
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>
    </li>
  );
}

/* ─── Per-session link picker ───────────────────────────────────── */

type SourceSession = Pick<CohortSessionRow, "id" | "title" | "startTime" | "timezone" | "meetingLink">;

function LinkPicker({
  cohortId, session, viewerTz, loadCohortList, cohortListError, onSaved, onClose,
}: {
  cohortId: string;
  session: CohortSessionRow;
  viewerTz: string | null;
  loadCohortList: () => Promise<CohortListItem[]>;
  cohortListError: string | null;
  onSaved: (s: CohortSessionRow, sourceCohortId?: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"custom" | "borrow">(
    session.linkedSessionId ? "borrow" : "custom"
  );
  const [customUrl, setCustomUrl] = useState(
    session.meetingLink && !session.linkedSessionId ? session.meetingLink : ""
  );
  const [cohorts, setCohorts] = useState<CohortListItem[] | null>(null);
  const [sourceCohortId, setSourceCohortId] = useState("");
  const [sourceSessions, setSourceSessions] = useState<SourceSession[] | null>(null);
  const [sourceZoomLink, setSourceZoomLink] = useState<string | null>(null);
  const [sourceSessionId, setSourceSessionId] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Cohort list is fetched lazily on first open of the borrow option.
  useEffect(() => {
    if (mode !== "borrow" || cohorts) return;
    let cancelled = false;
    loadCohortList().then((list) => {
      if (!cancelled) setCohorts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, cohorts, loadCohortList]);

  const pickCohort = async (id: string) => {
    setSourceCohortId(id);
    setSourceSessions(null);
    setSourceZoomLink(null);
    setSourceSessionId("");
    setErr(null);
    if (!id) return;
    setLoadingSource(true);
    try {
      const res = await fetch(`/api/cohorts/${id}`);
      if (!res.ok) throw new Error("Failed to load that cohort's sessions");
      const data = await res.json();
      const rows: SourceSession[] = data.sessions || [];
      setSourceSessions(rows);
      setSourceZoomLink(data.zoomLink ?? null);
      const match = matchSessionByInstant(rows, session.startTime);
      setSourceSessionId(match?.id ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoadingSource(false);
    }
  };

  const selectedSource = sourceSessions?.find((s) => s.id === sourceSessionId) ?? null;
  const resolvedPreview = selectedSource
    ? selectedSource.meetingLink ?? sourceZoomLink ?? null
    : null;

  const patch = async (body: Record<string, unknown>, srcCohort?: string) => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save link");
      onSaved(data.session, srcCohort);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save link");
    } finally {
      setSaving(false);
    }
  };

  const apply = () => {
    if (mode === "custom") {
      if (!isHttpUrl(customUrl)) {
        setErr("Enter a full URL starting with http:// or https://");
        return;
      }
      return patch({ meetingLink: customUrl.trim() });
    }
    if (!sourceSessionId) {
      setErr("Pick a session to borrow the link from.");
      return;
    }
    return patch({ linkedSessionId: sourceSessionId }, sourceCohortId);
  };

  const clear = () => patch({ meetingLink: null });

  const selectClass =
    "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white disabled:opacity-50";

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-3" data-testid="session-link-picker">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Join link for this session</p>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="radio"
          name={`link-mode-${session.id}`}
          checked={mode === "custom"}
          onChange={() => setMode("custom")}
          className="mt-1 h-4 w-4"
        />
        <span className="flex-1">
          <span className="font-medium text-slate-900 dark:text-white">Custom Zoom link</span>
          {mode === "custom" && (
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://zoom.us/j/..."
              className={selectClass + " mt-1.5"}
            />
          )}
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="radio"
          name={`link-mode-${session.id}`}
          checked={mode === "borrow"}
          onChange={() => setMode("borrow")}
          className="mt-1 h-4 w-4"
        />
        <span className="flex-1">
          <span className="font-medium text-slate-900 dark:text-white">Use a link from another cohort</span>
          {mode === "borrow" && (
            <div className="mt-1.5 space-y-2">
              {cohortListError && <p className="text-xs text-red-600 dark:text-red-400">{cohortListError}</p>}
              <select
                value={sourceCohortId}
                onChange={(e) => pickCohort(e.target.value)}
                disabled={!cohorts || saving}
                className={selectClass}
              >
                <option value="">{cohorts ? "Choose a cohort…" : "Loading cohorts…"}</option>
                {cohorts?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.status.toLowerCase().replace("_", " ")})
                  </option>
                ))}
              </select>
              {sourceCohortId && (
                <select
                  value={sourceSessionId}
                  onChange={(e) => setSourceSessionId(e.target.value)}
                  disabled={loadingSource || !sourceSessions || saving}
                  className={selectClass}
                >
                  <option value="">
                    {loadingSource
                      ? "Loading sessions…"
                      : sourceSessions && sourceSessions.length === 0
                      ? "That cohort has no sessions"
                      : "Choose a session…"}
                  </option>
                  {sourceSessions?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sessionWhenLines(s.startTime, s.timezone, viewerTz).main ?? "Not scheduled"} · {s.title}
                    </option>
                  ))}
                </select>
              )}
              {selectedSource && (
                <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
                  {resolvedPreview ? (
                    <>Will use: <span className="font-mono text-slate-700 dark:text-slate-200">{resolvedPreview}</span></>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400">No link on that session or its cohort — pick another.</span>
                  )}
                </p>
              )}
            </div>
          )}
        </span>
      </label>

      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={apply}
          disabled={saving || (mode === "borrow" && (!sourceSessionId || !resolvedPreview))}
          className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Apply
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={saving || !session.meetingLink}
          title="Fall back to the cohort's Zoom link"
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 disabled:opacity-50"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1.5"
        >
          <X className="h-3 w-3" /> Cancel
        </button>
      </div>
    </div>
  );
}
