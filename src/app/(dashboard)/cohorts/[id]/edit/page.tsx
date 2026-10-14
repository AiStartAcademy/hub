"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertCircle, Camera, CheckCircle } from "lucide-react";
import { CoverUploader } from "../../../courses/components/CoverUploader";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { SessionsPanel } from "./SessionsPanel";

interface CohortFormData {
  title: string;
  description: string;
  cover: string;
  status: string;
  deliveryMode: string;
  certificate: boolean;
  location: string;
  zoomLink: string;
  startDate: string;
  endDate: string;
  programIds: string[];
  memberEventType: "WEEKLY_QA" | null;
}

interface Program {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "ENROLLMENT", label: "Enrollment" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETE", label: "Complete" },
  { value: "ARCHIVED", label: "Archived" },
];

const DELIVERY_MODE_OPTIONS = [
  { value: "ONLINE", label: "Online" },
  { value: "INPERSON", label: "In Person" },
  { value: "HYBRID", label: "Hybrid" },
];

export default function EditCohortPage() {
  const params = useParams();
  const router = useRouter();
  const cohortId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [form, setForm] = useState<CohortFormData>({
    title: "",
    description: "",
    cover: "",
    status: "DRAFT",
    deliveryMode: "ONLINE",
    certificate: true,
    location: "",
    zoomLink: "",
    startDate: "",
    endDate: "",
    programIds: [],
    memberEventType: null,
  });

  // Fetch cohort data
  useEffect(() => {
    const fetchCohort = async () => {
      try {
        const res = await fetch(`/api/cohorts/${cohortId}`);
        if (!res.ok) throw new Error("Failed to fetch cohort");
        const data = await res.json();

        const pulledPrograms = data.programs
          ? data.programs.map((p: any) => p.id)
          : data.program?.id
          ? [data.program.id]
          : [];

        setForm({
          title: data.title || "",
          description: data.description || "",
          cover: data.cover || "",
          status: data.status || "DRAFT",
          deliveryMode: data.deliveryMode || "ONLINE",
          certificate: data.certificate ?? true,
          location: data.location || "",
          zoomLink: data.zoomLink || "",
          startDate: data.startDate ? data.startDate.split("T")[0] : "",
          endDate: data.endDate ? data.endDate.split("T")[0] : "",
          programIds: pulledPrograms,
          memberEventType: data.memberEventType === "WEEKLY_QA" ? "WEEKLY_QA" : null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load cohort");
      }
    };

    const fetchPrograms = async () => {
      try {
        const res = await fetch("/api/programs");
        if (res.ok) {
          const data = await res.json();
          setPrograms(Array.isArray(data) ? data : data.programs || []);
        }
      } catch (err) {
        console.warn("Failed to fetch programs:", err);
      }
    };

    Promise.all([fetchCohort(), fetchPrograms()]).finally(() => {
      setLoading(false);
    });
  }, [cohortId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const toggleProgram = (id: string) => {
    setForm((prev) => {
      const pIds = prev.programIds || [];
      return {
        ...prev,
        programIds: pIds.includes(id)
          ? pIds.filter((pId) => pId !== id)
          : [...pIds, id],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (!form.title.trim()) {
        throw new Error("Title is required");
      }

      const payload = {
        title: form.title.trim(),
        description: form.description?.trim() || null,
        cover: form.cover?.trim() || null,
        status: form.status,
        deliveryMode: form.deliveryMode,
        certificate: form.certificate,
        location: form.location?.trim() || null,
        zoomLink: form.zoomLink?.trim() || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        programIds: form.programIds,
        memberEventType: form.memberEventType,
      };

      const res = await fetch(`/api/cohorts/${cohortId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update cohort");
      }

      router.push(`/cohorts/${cohortId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const inputClass =
    "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all";
  const labelClass =
    "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5";

  return (
    <>
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 px-4 md:px-8 flex items-center flex-shrink-0 shadow-sm z-10">
        <div className="w-full max-w-4xl mx-auto flex items-center gap-3">
          <MobileMenuButton />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex-1">
            Edit Cohort
          </h1>
          <Link
            href={`/cohorts/${cohortId}`}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors group min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5 text-slate-500 group-hover:text-slate-800 dark:text-slate-400 dark:group-hover:text-slate-200" />
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-8">
        <div className="max-w-4xl mx-auto animate-fade-in">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <p className="text-rose-700 dark:text-rose-300 text-sm font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm hover:shadow-md transition-shadow">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
                Basic Information
              </h2>

              <div className="space-y-5">
                <div>
                  <label className={labelClass}>Title *</label>
                  <input
                    name="title"
                    type="text"
                    value={form.title}
                    onChange={handleChange}
                    placeholder="e.g. AI Ops Intensive Fall '24"
                    required
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Description</label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    placeholder="Brief description of this cohort..."
                    rows={4}
                    className={`${inputClass} resize-none`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Cover Image</label>
                  <div className="mt-2">
                    <CoverUploader 
                      currentCover={form.cover}
                      onCoverChange={(url) => setForm(prev => ({ ...prev, cover: url || "" }))} 
                      onUploadingChange={setIsUploadingImage}
                      entityName={form.title}
                      entityType="cohort"
                      disabled={saving}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm hover:shadow-md transition-shadow">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
                Linked Courses/Programs
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/50">
                {programs.map((p) => {
                  const isSelected = form.programIds?.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProgram(p.id)}
                      className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900"
                      }`}
                    >
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate pr-4">
                        {p.name}
                      </span>
                      <div
                        className={`w-4 h-4 flex-shrink-0 rounded-full border flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-primary border-primary text-white"
                            : "border-slate-300 dark:border-slate-700"
                        }`}
                      >
                        {isSelected && <CheckCircle className="h-3 w-3" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm hover:shadow-md transition-shadow">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
                Status & Format
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    name="status"
                    value={form.status}
                    onChange={handleChange}
                    className={inputClass}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Delivery Mode</label>
                  <select
                    name="deliveryMode"
                    value={form.deliveryMode}
                    onChange={handleChange}
                    className={inputClass}
                  >
                    {DELIVERY_MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="certificate"
                    checked={form.certificate}
                    onChange={(e) => setForm({ ...form, certificate: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary" />
                </label>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Awards a completion certificate
                </span>
              </div>

              {/* Members mirror: sessions of this cohort appear under Member Calls */}
              <div className="mt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="memberEventType"
                    checked={form.memberEventType === "WEEKLY_QA"}
                    onChange={(e) =>
                      setForm({ ...form, memberEventType: e.target.checked ? "WEEKLY_QA" : null })
                    }
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Show sessions in Member Calls as Weekly Q&amp;A
                  </span>
                </label>
                <p className="mt-1 text-xs text-slate-400">
                  Members see these sessions (and recordings) under Member Calls.
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm hover:shadow-md transition-shadow">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
                Location & Links
              </h2>

              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Location</label>
                  <input
                    name="location"
                    type="text"
                    value={form.location}
                    onChange={handleChange}
                    placeholder="e.g. San Francisco, CA"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Zoom Link</label>
                  <input
                    name="zoomLink"
                    type="url"
                    value={form.zoomLink}
                    onChange={handleChange}
                    placeholder="https://zoom.us/j/..."
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm hover:shadow-md transition-shadow">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-5 border-b border-slate-100 dark:border-slate-800 pb-3">
                Schedule
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Start Date</label>
                  <input
                    name="startDate"
                    type="date"
                    value={form.startDate}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>End Date</label>
                  <input
                    name="endDate"
                    type="date"
                    value={form.endDate}
                    onChange={handleChange}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            <SessionsPanel cohortId={cohortId} zoomLink={form.zoomLink} />

            <div className="flex items-center justify-end gap-4 pt-4 pb-8">
              <Link
                href={`/cohorts/${cohortId}`}
                className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </Link>

              <button
                type="submit"
                disabled={saving || isUploadingImage}
                className="px-6 py-2.5 rounded-xl text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-all shadow-sm flex items-center gap-2 hover:shadow-md hover:shadow-primary/20 disabled:opacity-50"
              >
                {(saving || isUploadingImage) && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Saving..." : isUploadingImage ? "Uploading cover..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
