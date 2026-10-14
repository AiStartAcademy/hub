"use client";
// src/app/(dashboard)/admin/content/new/NewContentClient.tsx
// "New Blog Post / Landing Page" form — same fields as the roadmap CSV, plus a
// template selector. Creates a DRAFT (POST /api/admin/content), then opens the
// editor so the team can generate (agent) or write the body.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { CONTENT_TEMPLATES } from "@/lib/content";

type ContentType = "BLOG" | "LANDING";

const FUNNEL = ["Awareness", "Consideration", "Conversion"];
const PRIORITY = ["", "P1", "P2", "P3"];

export default function NewContentClient({ type }: { type: ContentType }) {
  const router = useRouter();
  const isLanding = type === "LANDING";
  const templates = CONTENT_TEMPLATES[type];

  const [f, setF] = useState<Record<string, string>>({
    slug: "",
    primaryKeyword: "",
    secondaryKeywords: "",
    metaTitle: "",
    metaDescription: "",
    h1: "",
    funnelStage: isLanding ? "Conversion" : "Awareness",
    segment: "",
    sectionsPlan: "",
    schemaTypes: isLanding ? "Course; FAQPage" : "Article; FAQPage",
    priority: "",
    guardrails: "",
    proofVariant: "",
    template: templates[0]?.value ?? "default",
  });
  const [indexable, setIndexable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function set(k: string, v: string) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/admin/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, ...f, indexable }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/admin/content/${data.id}/edit`);
    } else {
      setMsg(data.error || "Failed to create");
      setSaving(false);
    }
  }

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#1a1f3d] text-sm";
  const Field = ({
    k, label, required, textarea, placeholder,
  }: { k: string; label: string; required?: boolean; textarea?: boolean; placeholder?: string }) => (
    <label className="block">
      <span className="block text-sm font-medium mb-1 text-[#11131D] dark:text-white">
        {label}{required && <span className="text-rose-500"> *</span>}
      </span>
      {textarea ? (
        <textarea value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} rows={2} placeholder={placeholder} className={inputCls} />
      ) : (
        <input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className={inputCls} />
      )}
    </label>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link href="/admin/content" className="inline-flex items-center gap-1.5 text-sm text-[#6C757D] hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to content
        </Link>
        <h1 className="text-lg font-bold text-[#11131D] dark:text-white">
          New {isLanding ? "Landing Page" : "Blog Post"}
        </h1>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {/* Template selector */}
        <label className="block">
          <span className="block text-sm font-medium mb-1 text-[#11131D] dark:text-white">Template</span>
          <select value={f.template} onChange={(e) => set("template", e.target.value)} className={inputCls}>
            {templates.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <span className="text-xs text-[#9AA3B2]">The default matches what we ship across {isLanding ? "landing pages" : "blog posts"} today.</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field k="slug" label="Slug" required placeholder={isLanding ? "ai-bootcamp-san-francisco" : "how-to-learn-ai"} />
          <label className="block">
            <span className="block text-sm font-medium mb-1 text-[#11131D] dark:text-white">Funnel stage <span className="text-rose-500">*</span></span>
            <select value={f.funnelStage} onChange={(e) => set("funnelStage", e.target.value)} className={inputCls}>
              {FUNNEL.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <Field k="primaryKeyword" label="Primary keyword" required />
        <Field k="secondaryKeywords" label="Secondary keywords" placeholder="semicolon-separated" />
        <Field k="metaTitle" label="Meta title" required />
        <Field k="metaDescription" label="Meta description" required textarea />
        <Field k="h1" label="H1" required />
        <Field k="sectionsPlan" label="Recommended H2 / sections" textarea placeholder="Intro. Section A. Section B. FAQ. CTA." />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1 text-[#11131D] dark:text-white">Priority</span>
            <select value={f.priority} onChange={(e) => set("priority", e.target.value)} className={inputCls}>
              {PRIORITY.map((p) => <option key={p} value={p}>{p || "—"}</option>)}
            </select>
          </label>
          <Field k="segment" label="Segment" placeholder="beginners / professionals" />
          <Field k="schemaTypes" label="Schema" />
        </div>

        {isLanding && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <Field k="proofVariant" label="Proof variant" placeholder="which real proof to feature" />
            <label className="flex items-center gap-2 text-sm text-[#11131D] dark:text-white pb-2">
              <input type="checkbox" checked={indexable} onChange={(e) => setIndexable(e.target.checked)} />
              Indexable (uncheck for paid-ad-only pages)
            </label>
          </div>
        )}

        <Field k="guardrails" label="Notes / guardrails" textarea placeholder="Hard constraints honored at review (e.g. don't claim job placement)." />

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50">
            <Plus className="h-4 w-4" /> {saving ? "Creating…" : "Create draft"}
          </button>
          {msg && <span className="text-sm text-rose-500">{msg}</span>}
        </div>
      </form>
    </div>
  );
}
