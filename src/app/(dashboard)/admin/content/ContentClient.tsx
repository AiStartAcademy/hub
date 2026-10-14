"use client";
// src/app/(dashboard)/admin/content/ContentClient.tsx
// CMS list: two tabs (Blog Posts | Landing Pages), status filter, row actions
// (edit/publish/disable/archive/delete) and CSV import. Talks to /api/admin/content.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Upload, RefreshCw, Plus } from "lucide-react";

type ContentType = "BLOG" | "LANDING";

interface Row {
  id: string;
  type: ContentType;
  slug: string;
  url: string;
  status: string;
  funnelStage: string;
  segment: string | null;
  metaTitle: string;
  wordCount: number | null;
  updatedAt: string;
  publishedAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300",
  GENERATING: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  READY_FOR_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  IN_REVIEW: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  PUBLISHED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  DISABLED: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  ARCHIVED: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
};

// Minimal RFC-4180-ish CSV parser (handles quoted fields with commas/newlines).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v !== "")) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export default function ContentClient() {
  const [type, setType] = useState<ContentType>("BLOG");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ type });
    if (status) qs.set("status", status);
    const res = await fetch(`/api/admin/content?${qs}`);
    const data = await res.json();
    setRows(res.ok ? data.pages : []);
    setLoading(false);
  }, [type, status]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "publish" | "disable" | "archive") {
    setBusy(id);
    const res = await fetch(`/api/admin/content/${id}/${action}`, { method: "POST" });
    setMsg(res.ok ? `${action}ed` : `Failed to ${action}`);
    setBusy(null);
    load();
  }

  async function del(id: string, slug: string) {
    if (!confirm(`Permanently delete "${slug}"? This cannot be undone.`)) return;
    setBusy(id);
    const res = await fetch(`/api/admin/content/${id}`, { method: "DELETE" });
    setMsg(res.ok ? "deleted" : "delete forbidden (ADMIN only)");
    setBusy(null);
    load();
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const parsed = parseCsv(await file.text());
    if (!parsed.length) { setMsg("No rows parsed from CSV"); return; }
    setMsg(`Importing ${parsed.length} rows…`);
    const res = await fetch(`/api/admin/content/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, source: file.name, rows: parsed }),
    });
    const data = await res.json();
    setMsg(res.ok ? `Imported: ${data.created} new, ${data.skipped} updated/skipped` : `Import failed: ${data.error}`);
    if (fileRef.current) fileRef.current.value = "";
    load();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#11131D] dark:text-white">
          <FileText className="h-6 w-6 text-rose-500" /> Content
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] hover:bg-[#EEF1F6] dark:hover:bg-white/5">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] hover:bg-[#EEF1F6] dark:hover:bg-white/5">
            <Upload className="h-4 w-4" /> Import CSV
          </button>
          <Link href={`/admin/content/new?type=${type}`} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-dark">
            <Plus className="h-4 w-4" /> New {type === "BLOG" ? "Blog Post" : "Landing Page"}
          </Link>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[#D9DEE8] dark:border-[#2e3560]">
        {(["BLOG", "LANDING"] as ContentType[]).map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${type === t ? "border-rose-500 text-rose-500" : "border-transparent text-[#6C757D] hover:text-[#11131D] dark:hover:text-white"}`}>
            {t === "BLOG" ? "Blog Posts" : "Landing Pages"}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#1a1f3d]">
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLES).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {msg && <span className="text-sm text-[#6C757D]">{msg}</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#D9DEE8] dark:border-[#2e3560]">
        <table className="w-full text-sm">
          <thead className="bg-[#F5F7FA] dark:bg-white/5 text-left text-[#6C757D]">
            <tr>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Words</th>
              <th className="px-4 py-3 font-medium">Updated</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#D9DEE8] dark:divide-[#2e3560]">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[#6C757D]">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[#6C757D]">No {type === "BLOG" ? "posts" : "pages"} yet. Import a CSV to queue topics.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-[#F5F7FA] dark:hover:bg-white/5">
                <td className="px-4 py-3 max-w-xs truncate text-[#11131D] dark:text-white">{r.metaTitle}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#6C757D]">{r.slug}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</span></td>
                <td className="px-4 py-3 text-[#6C757D]">{r.funnelStage}</td>
                <td className="px-4 py-3 text-[#6C757D]">{r.wordCount ?? "—"}</td>
                <td className="px-4 py-3 text-[#6C757D]">{new Date(r.updatedAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2 text-xs">
                    <Link href={`/admin/content/${r.id}/edit`} className="text-primary hover:underline">Edit</Link>
                    {r.status !== "PUBLISHED" && r.status !== "ARCHIVED" && (
                      <button disabled={busy === r.id} onClick={() => act(r.id, "publish")} className="text-emerald-600 hover:underline disabled:opacity-40">Publish</button>
                    )}
                    {r.status === "PUBLISHED" && (
                      <button disabled={busy === r.id} onClick={() => act(r.id, "disable")} className="text-orange-600 hover:underline disabled:opacity-40">Disable</button>
                    )}
                    {r.status !== "ARCHIVED" && (
                      <button disabled={busy === r.id} onClick={() => act(r.id, "archive")} className="text-[#6C757D] hover:underline disabled:opacity-40">Archive</button>
                    )}
                    <button disabled={busy === r.id} onClick={() => del(r.id, r.slug)} className="text-rose-600 hover:underline disabled:opacity-40">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
