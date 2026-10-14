"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Trash2, Pencil, ExternalLink, Loader2, Copy } from "lucide-react";
import { createOnboardingForm, deleteOnboardingForm } from "./actions";
import { MobileMenuButton } from "@/components/MobileMenuButton";

interface Form {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  createdAt: string;
  steps: { id: string }[];
  responses: { id: string }[];
}

export default function OnboardingListClient({ forms: initial }: { forms: Form[] }) {
  const router = useRouter();
  const [forms, setForms] = useState<Form[]>(initial);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newSlug.trim()) return;
    setCreating(true);
    try {
      const form = await createOnboardingForm({ title: newTitle.trim(), slug: newSlug.trim(), description: newDesc.trim() || undefined });
      setForms([{ ...form, steps: [], responses: [] } as any, ...forms]);
      setShowCreate(false);
      setNewTitle("");
      setNewSlug("");
      setNewDesc("");
      router.push(`/admin/onboarding/${form.id}/edit`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this onboarding form and all its data?")) return;
    setDeleting(id);
    try {
      await deleteOnboardingForm(id);
      setForms(forms.filter((f) => f.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/onboarding/${slug}`;
    navigator.clipboard.writeText(url);
    setCopied(slug);
    setTimeout(() => setCopied(null), 2000);
  };

  const slugify = (val: string) =>
    val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between px-4 md:px-8 flex-shrink-0 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MobileMenuButton />
          <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 truncate">
            <ClipboardList className="h-5 w-5 md:h-6 md:w-6 text-primary flex-shrink-0" />
            Onboarding Forms
          </h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 md:px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-xl shadow transition-all flex-shrink-0 min-h-[44px]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Form</span>
          <span className="sm:hidden">New</span>
        </button>
      </header>

      <div className="flex-1 overflow-auto p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-4xl mx-auto space-y-4">
          {forms.length === 0 && (
            <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <ClipboardList className="h-12 w-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">No forms yet</h3>
              <p className="text-slate-500 text-sm">Create your first onboarding form.</p>
            </div>
          )}

          {forms.map((form) => (
            <div
              key={form.id}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">{form.title}</h2>
                {form.description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">{form.description}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                  <span>{form.steps.length} steps</span>
                  <span>{form.responses.length} responses</span>
                  <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">/onboarding/{form.slug}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => copyLink(form.slug)}
                  title="Copy public link"
                  className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors"
                >
                  {copied === form.slug ? <Copy className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </button>
                <a
                  href={`/onboarding/${form.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors"
                  title="Open public page"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  onClick={() => router.push(`/admin/onboarding/${form.id}/edit`)}
                  className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors"
                  title="Edit form"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(form.id)}
                  disabled={deleting === form.id}
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                  title="Delete form"
                >
                  {deleting === form.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5">New Onboarding Form</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => { setNewTitle(e.target.value); setNewSlug(slugify(e.target.value)); }}
                  placeholder="e.g. Course Finder Quiz"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">URL Slug</label>
                <div className="flex items-center gap-2 px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
                  <span className="text-slate-400 whitespace-nowrap">/onboarding/</span>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(e) => setNewSlug(slugify(e.target.value))}
                    placeholder="my-quiz"
                    className="flex-1 bg-transparent focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Description (optional)</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newTitle.trim() || !newSlug.trim()}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                Create & Edit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
