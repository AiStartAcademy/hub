"use client";
// src/app/(dashboard)/admin/content/[id]/edit/EditContentClient.tsx
// Review/edit a generated content page: metadata, body, and structured blocks
// (FAQ / CTAs / sources) as JSON. PATCHes /api/admin/content/[id]. A rich Tiptap
// editor for `bodyHtml` is a follow-up; the textarea keeps review functional today.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";

interface Page {
  id: string;
  type: string;
  slug: string;
  url: string;
  status: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  primaryKeyword: string;
  secondaryKeywords: string | null;
  segment: string | null;
  funnelStage: string;
  guardrails: string | null;
  answerBlock: string | null;
  bodyHtml: string | null;
  wordCount: number | null;
  faq: unknown;
  sources: unknown;
  ctas: unknown;
  videos: unknown;
}

const TEXT_FIELDS: { key: keyof Page; label: string; textarea?: boolean }[] = [
  { key: "metaTitle", label: "Meta title" },
  { key: "metaDescription", label: "Meta description", textarea: true },
  { key: "h1", label: "H1" },
  { key: "primaryKeyword", label: "Primary keyword" },
  { key: "secondaryKeywords", label: "Secondary keywords" },
  { key: "segment", label: "Segment" },
  { key: "answerBlock", label: "Answer block (GEO/AEO 40–60w)", textarea: true },
];

const JSON_FIELDS: { key: keyof Page; label: string }[] = [
  { key: "faq", label: "FAQ  [{q,a}]" },
  { key: "ctas", label: "CTAs  [{position,label,href,gaEvent}]" },
  { key: "sources", label: "Sources  [{title,url}]" },
  { key: "videos", label: "Videos  [{title,youtubeId}]" },
];

export default function EditContentClient({ id }: { id: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/content/${id}`);
    if (!res.ok) { setMsg("Failed to load"); return; }
    const p = (await res.json()) as Page;
    setPage(p);
    const f: Record<string, string> = {};
    for (const { key } of TEXT_FIELDS) f[key as string] = (p[key] as string) ?? "";
    f.bodyHtml = p.bodyHtml ?? "";
    f.guardrails = p.guardrails ?? "";
    for (const { key } of JSON_FIELDS) f[key as string] = p[key] ? JSON.stringify(p[key], null, 2) : "";
    setForm(f);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function set(key: string, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const payload: Record<string, unknown> = {};
    for (const { key } of TEXT_FIELDS) payload[key as string] = form[key as string];
    payload.bodyHtml = form.bodyHtml;
    payload.guardrails = form.guardrails;
    // Parse JSON fields; abort on invalid JSON so we never store garbage.
    for (const { key, label } of JSON_FIELDS) {
      const raw = form[key as string]?.trim();
      if (!raw) { payload[key as string] = null; continue; }
      try { payload[key as string] = JSON.parse(raw); }
      catch { setMsg(`Invalid JSON in "${label}"`); setSaving(false); return; }
    }
    const res = await fetch(`/api/admin/content/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setMsg(res.ok ? "Saved ✓" : "Save failed");
    setSaving(false);
    if (res.ok) load();
  }

  if (!page) return <div className="p-6 text-[#6C757D]">{msg ?? "Loading…"}</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Link href="/admin/content" className="inline-flex items-center gap-1.5 text-sm text-[#6C757D] hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to content
        </Link>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-[#6C757D]">{msg}</span>}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="mb-6">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-white/10">{page.type}</span>
        <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-white/10">{page.status}</span>
        <span className="ml-2 font-mono text-xs text-[#6C757D]">{page.url}</span>
      </div>

      {page.guardrails && (
        <div className="mb-6 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-sm text-amber-800 dark:text-amber-200">
          <strong>Guardrails:</strong> {page.guardrails}
        </div>
      )}

      <div className="space-y-4">
        {TEXT_FIELDS.map(({ key, label, textarea }) => (
          <label key={key as string} className="block">
            <span className="block text-sm font-medium mb-1 text-[#11131D] dark:text-white">{label}</span>
            {textarea ? (
              <textarea value={form[key as string] ?? ""} onChange={(e) => set(key as string, e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#1a1f3d] text-sm" />
            ) : (
              <input value={form[key as string] ?? ""} onChange={(e) => set(key as string, e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#1a1f3d] text-sm" />
            )}
          </label>
        ))}

        <label className="block">
          <span className="block text-sm font-medium mb-1 text-[#11131D] dark:text-white">Body (HTML)</span>
          <textarea value={form.bodyHtml ?? ""} onChange={(e) => set("bodyHtml", e.target.value)} rows={16}
            className="w-full px-3 py-2 rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#1a1f3d] font-mono text-xs" />
        </label>

        {JSON_FIELDS.map(({ key, label }) => (
          <label key={key as string} className="block">
            <span className="block text-sm font-medium mb-1 text-[#11131D] dark:text-white">{label}</span>
            <textarea value={form[key as string] ?? ""} onChange={(e) => set(key as string, e.target.value)} rows={5}
              className="w-full px-3 py-2 rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#1a1f3d] font-mono text-xs" placeholder="JSON" />
          </label>
        ))}
      </div>
    </div>
  );
}
