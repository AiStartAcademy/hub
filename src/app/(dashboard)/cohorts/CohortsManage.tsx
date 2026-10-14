"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Users,
  Plus,
  Search,
  Calendar,
  ArrowRight,
  Loader2,
  X,
  MapPin,
  Monitor,
  Globe,
  Pencil,
  Trash2,
  UserPlus,
  DollarSign,
  LogIn,
  Layers,
  CheckCircle,
} from "lucide-react";
import { CoverUploader } from "../courses/components/CoverUploader";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import dynamic from "next/dynamic";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import { toCalendarDate } from "@/lib/calendarDate";
// Tiptap rich-text editor — client-only (avoids SSR hydration issues).
const Editor = dynamic(() => import("@/components/Editor"), { ssr: false });


interface CohortData {
  id: string;
  title: string;
  description: string | null;
  createdAt?: string; 
  cover: string | null;
  status: string;
  seats: number;
  deliveryMode: string;
  location: string | null;
  zoomLink: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  tools?: string | null;
  certificate?: boolean;
  leadMagnet?: boolean;
  leadMagnetCta?: string | null;
  memberEventType?: string | null;
  totalMembers: number;
  isEnrolled?: boolean;
  _count: {
    groups: number;
    sessions: number;
  };
  instructors?: {
    id: string;
    name: string | null;
    image: string | null;
  }[];
  programs?: {
    id: string;
    name: string;
  }[];
}

interface ProgramOption {
  id: string;
  name: string;
}

interface CohortFormData {
  title: string;
  description: string;
  cover: string;
  status: string;
  deliveryMode: string;
  location: string;
  zoomLink: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  tools: string;
  certificate: boolean;
  leadMagnet: boolean;
  leadMagnetCta: string;
  memberEventType: "WEEKLY_QA" | null;
  programIds: string[];
}

interface JoinGroupData {
  id: string;
  name: string;
  inPerson: boolean;
  price: number;
  seats: number;
  members?: unknown[];
  _count?: { members: number };
}

const stripHtmlTags = (html: string) => {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
};

const STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "ENROLLMENT", label: "Enrollment" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETE", label: "Complete" },
  { value: "ARCHIVED", label: "Archived" },
];

const DELIVERY_MODES = [
  { value: "INPERSON", label: "In Person", icon: MapPin },
  { value: "ONLINE", label: "Online", icon: Monitor },
  { value: "HYBRID", label: "Hybrid", icon: Globe },
];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  ENROLLMENT:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  IN_PROGRESS:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  COMPLETE:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  ARCHIVED:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

const DELIVERY_STYLES: Record<string, string> = {
  INPERSON:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  ONLINE: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  HYBRID:
    "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
};

function StatusBadge({ status }: { status: string }) {
  const label = STATUSES.find((s) => s.value === status)?.label || status;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        STATUS_STYLES[status] || STATUS_STYLES.DRAFT
      }`}
    >
      {status === "IN_PROGRESS" && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
      )}
      {label}
    </span>
  );
}

function DeliveryBadge({ mode }: { mode: string }) {
  const dm = DELIVERY_MODES.find((d) => d.value === mode);
  const Icon = dm?.icon || Globe;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        DELIVERY_STYLES[mode] || DELIVERY_STYLES.ONLINE
      }`}
    >
      <Icon className="h-3 w-3" />
      {dm?.label || mode}
    </span>
  );
}

/* ─── Cohort Create/Edit Modal ───────────────────────────────────── */
function CohortModal({
  cohort,
  onClose,
  onSaved,
}: {
  cohort?: CohortData | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [form, setForm] = useState<CohortFormData>({
    title: cohort?.title || "",
    description: cohort?.description || "",
    cover: cohort?.cover || "",
    status: cohort?.status || "DRAFT",
    deliveryMode: cohort?.deliveryMode || "ONLINE",
    location: cohort?.location || "",
    zoomLink: cohort?.zoomLink || "",
    startDate: toCalendarDate(cohort?.startDate) || "",
    endDate: toCalendarDate(cohort?.endDate) || "",
    startTime: cohort?.startTime || "",
    endTime: cohort?.endTime || "",
    timezone: cohort?.timezone || "PT",
    tools: cohort?.tools || "",
    certificate: cohort?.certificate ?? true,
    leadMagnet: cohort?.leadMagnet ?? false,
    leadMagnetCta: cohort?.leadMagnetCta || "",
    memberEventType: cohort?.memberEventType === "WEEKLY_QA" ? "WEEKLY_QA" : null,
    programIds: cohort?.programs?.map((p) => p.id) || [],
  });

  const [allPrograms, setAllPrograms] = useState<ProgramOption[]>([]);

  useEffect(() => {
    fetch("/api/programs")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAllPrograms(data);
      })
      .catch((err) => console.error("Failed to fetch programs", err));
  }, []);

  const toggleProgram = (id: string) => {
    setForm((prev) => {
      const pIds = prev.programIds || [];
      return {
        ...prev,
        programIds: pIds.includes(id)
          ? pIds.filter((pId: string) => pId !== id)
          : [...pIds, id],
      };
    });
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = cohort ? `/api/cohorts/${cohort.id}` : "/api/cohorts";
      const method = cohort ? "PUT" : "POST";
      const payload = { ...form };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save cohort");
      }
    } catch {
      alert("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all";
  const labelClass =
    "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {cohort ? "Edit Cohort" : "Create Cohort"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className={labelClass}>Title *</label>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              required
              placeholder="e.g. AI Ops Intensive Fall '24"
              className={inputClass}
            />
          </div>

          {/* Description (rich text → HTML) */}
          <div>
            <label className={labelClass}>Description</label>
            <Editor
              content={form.description}
              onChange={(html) => setForm((prev) => ({ ...prev, description: html }))}
              placeholder="Describe this cohort — about, who it's for, outcomes…"
            />
          </div>

          {/* Cover Image Upload */}
          <div>
            <div className="mt-2 text-left">
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

          {/* Status + Delivery Mode */}
          <div className="grid grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
                Linked Courses/Programs
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/50">
                {allPrograms.map((p) => {
                  const isSelected = form.programIds?.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProgram(p.id)}
                      className={`flex items-center justify-between p-3 rounded-lg border text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      }`}
                    >
                      {/* Only show 'Recordings' if the program name follows the 'Recordings (CohortName)' pattern */}
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                        {p.name.startsWith("Recordings (") ? "Recordings" : p.name}
                      </span>
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-primary border-primary text-white"
                            : "border-slate-300 dark:border-slate-700"
                        }`}
                      >
                        {isSelected && <CheckCircle className="h-2.5 w-2.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-2 border-t border-slate-100 dark:border-slate-800 my-2" />

            <div>
              <label className={labelClass}>Status</label>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className={inputClass}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
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
                {DELIVERY_MODES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>


          {/* Dates */}
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

          {/* Times */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Start Time</label>
              <input
                name="startTime"
                value={form.startTime}
                onChange={handleChange}
                placeholder="10:00am"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>End Time</label>
              <input
                name="endTime"
                value={form.endTime}
                onChange={handleChange}
                placeholder="5:00pm"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Timezone</label>
              <select
                name="timezone"
                value={form.timezone}
                onChange={handleChange}
                className={inputClass}
              >
                <option value="PT">PT</option>
                <option value="ET">ET</option>
                <option value="CT">CT</option>
                <option value="MT">MT</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>

          {/* Tools (free-text tag list) */}
          <div>
            <label className={labelClass}>Tools</label>
            <input
              name="tools"
              value={form.tools}
              onChange={handleChange}
              placeholder="Claude Code, n8n, VAPI, ElevenLabs, Twilio, OpenClaw"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">Comma-separated — shown as tags on the cohort page.</p>
          </div>

          {/* Certificate */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="certificate"
                checked={form.certificate}
                onChange={(e) => setForm({ ...form, certificate: e.target.checked })}
                className="h-4 w-4"
              />
              <span className={labelClass} style={{ marginBottom: 0 }}>Awards a completion certificate</span>
            </label>
            <p className="mt-1 text-xs text-slate-400">Shows a &ldquo;🎓 Certificate&rdquo; badge on the public cohort listing.</p>
          </div>

          {/* Lead magnet (free Q&A/workshop) */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="leadMagnet"
                checked={form.leadMagnet}
                onChange={(e) => setForm({ ...form, leadMagnet: e.target.checked })}
                className="h-4 w-4"
              />
              <span className={labelClass} style={{ marginBottom: 0 }}>Free lead magnet (Q&amp;A / workshop)</span>
            </label>
            <p className="mt-1 text-xs text-slate-400">Shows in a &ldquo;Free events&rdquo; strip with email-only registration (no checkout); registrants become leads.</p>
            {form.leadMagnet && (
              <input
                name="leadMagnetCta"
                value={form.leadMagnetCta}
                onChange={handleChange}
                placeholder="Save your spot — free"
                className={inputClass + " mt-2"}
              />
            )}
          </div>

          {/* Members mirror: sessions of this cohort appear under Member Calls */}
          <div>
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
              <span className={labelClass} style={{ marginBottom: 0 }}>Show sessions in Member Calls as Weekly Q&amp;A</span>
            </label>
            <p className="mt-1 text-xs text-slate-400">Members see these sessions (and recordings) under Member Calls.</p>
          </div>

          {/* Location */}
          <div>
            <label className={labelClass}>Location</label>
            <input
              name="location"
              value={form.location}
              onChange={handleChange}
              placeholder="e.g. San Francisco, CA"
              className={inputClass}
            />
          </div>

          {/* Zoom Link */}
          <div>
            <label className={labelClass}>Zoom Link</label>
            <input
              name="zoomLink"
              value={form.zoomLink}
              onChange={handleChange}
              placeholder="https://zoom.us/j/..."
              className={inputClass}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || isUploadingImage}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 hover:shadow-md hover:shadow-primary/20"
            >
              {(saving || isUploadingImage) && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving..." : isUploadingImage ? "Uploading cover..." : (cohort ? "Save Changes" : "Create Cohort")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Join Group Modal ───────────────────────────────────────────── */
function JoinGroupModal({
  cohortId,
  cohortTitle,
  onClose,
  onJoined,
}: {
  cohortId: string;
  cohortTitle: string;
  onClose: () => void;
  onJoined: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<JoinGroupData[]>([]);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/cohorts/${cohortId}`)
      .then((res) => res.json())
      .then((data) => {
        setGroups(data.groups || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cohortId]);

  const handleJoin = async (groupId: string, price: number) => {
    if (price > 0) {
      router.push(`/cohorts/${cohortId}/pay/${groupId}`);
      return;
    }
    setJoining(groupId);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      if (res.ok) {
        onJoined();
        onClose();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to join");
      }
    } catch {
      alert("Something went wrong");
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Join Cohort
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {cohortTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No groups available for this cohort yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => {
                const memberCount =
                  group._count?.members || group.members?.length || 0;
                const seatsLeft = group.seats - memberCount;
                const isFull = seatsLeft <= 0;
                return (
                  <div
                    key={group.id}
                    className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary/30 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {group.name}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {isFull ? "Full" : `${seatsLeft} seats left`}
                        </span>
                        <span
                          className={`text-xs font-semibold ${
                            group.price > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {group.price > 0
                            ? `$${group.price.toFixed(2)}`
                            : "Free"}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                            group.inPerson
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                              : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                          }`}
                        >
                          {group.inPerson ? "In Person" : "Online"}
                        </span>
                      </div>
                    </div>
                    {isFull ? (
                      <span className="text-xs text-slate-400 font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        Full
                      </span>
                    ) : group.price > 0 ? (
                      <button
                        onClick={() => handleJoin(group.id, group.price)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-1.5 shadow-sm"
                      >
                        <DollarSign className="h-3 w-3" />
                        Pay & Join
                      </button>
                    ) : (
                      <button
                        onClick={() => handleJoin(group.id, group.price)}
                        disabled={joining === group.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                      >
                        {joining === group.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <UserPlus className="h-3 w-3" />
                        )}
                        Join Free
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Delete Cohort Modal ────────────────────────────────────────── */
function DeleteCohortModal({
  cohortTitle,
  onClose,
  onConfirm,
}: {
  cohortTitle: string;
  onClose: () => void;
  onConfirm: (deleteRaw: boolean) => void;
}) {
  const [deleteRaw, setDeleteRaw] = useState(false); // Unchecked by default
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    await onConfirm(deleteRaw);
    setDeleting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-sm animate-fade-in p-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
          Delete Cohort
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Are you sure you want to delete <strong>{cohortTitle}</strong>? This action cannot be undone.
        </p>

        <label className="flex items-start gap-3 mb-6 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
          <input
            type="checkbox"
            checked={deleteRaw}
            onChange={(e) => setDeleteRaw(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-rose-500 focus:ring-rose-500"
          />
          <span className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-tight">
            Delete associated &quot;Recordings&quot; course and data
            <span className="block text-xs font-normal text-slate-500 dark:text-slate-400 mt-1">
              If unchecked, the recordings course will remain as an archive.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-rose-500 hover:bg-rose-600 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────── */
export default function CohortsManage() {
  const { data: session } = useSession();
  const [cohorts, setCohorts] = useState<CohortData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("DEFAULT");
  const [showModal, setShowModal] = useState(false);
  const [editingCohort, setEditingCohort] = useState<CohortData | null>(null);
  const [joinCohortId, setJoinCohortId] = useState<string | null>(null);
  const [joinCohortTitle, setJoinCohortTitle] = useState("");
  const [deletingCohort, setDeletingCohort] = useState<{ id: string; title: string } | null>(null);

  const router = useRouter();
  const userRole = session?.user
    ? (session.user as { role?: string }).role || "STUDENT"
    : "GUEST";
  const canManage = hasAnyRole(session?.user, MANAGE_ROLES);
  const isGuest = !session?.user;
  const isStudent = userRole === "STUDENT";

  const fetchCohorts = useCallback(async () => {
    try {
      const res = await fetch("/api/cohorts");
      const data = await res.json();
      if (res.ok) setCohorts(data);
    } catch (error) {
      console.error("Failed to fetch cohorts", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial remote-data synchronization for this client management view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCohorts();
  }, [fetchCohorts]);

  const handleDeleteClick = (cohort: CohortData, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingCohort({ id: cohort.id, title: cohort.title });
  };

  const confirmDelete = async (deleteRaw: boolean) => {
    if (!deletingCohort) return;
    try {
      const res = await fetch(`/api/cohorts/${deletingCohort.id}?deleteRaw=${deleteRaw}`, { 
        method: "DELETE" 
      });
      if (res.ok) {
        fetchCohorts();
      } else {
        alert("Failed to delete cohort");
      }
    } catch {
      alert("Something went wrong during deletion");
    } finally {
      setDeletingCohort(null);
    }
  };

  const handleEdit = (cohort: CohortData, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingCohort(cohort);
    setShowModal(true);
  };

    const filteredCohorts = cohorts
      .filter((c) => {
        // Students and guests: filter visibility by status and enrollment
        if (!canManage) {
          const isVisible =
            c.status === "ENROLLMENT" ||
            (c.isEnrolled && ["IN_PROGRESS", "COMPLETE", "ARCHIVED"].includes(c.status));
          if (!isVisible) return false;
        }

        const matchesSearch = c.title
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesStatus =
          statusFilter === "ALL" || c.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => {
        if (sortBy === "START_DATE_DESC") {
          const dateA = a.startDate ? new Date(a.startDate).getTime() : 0;
          const dateB = b.startDate ? new Date(b.startDate).getTime() : 0;
          return dateB - dateA;
        }
        if (sortBy === "START_DATE_ASC") {
          const dateA = a.startDate ? new Date(a.startDate).getTime() : Infinity;
          const dateB = b.startDate ? new Date(b.startDate).getTime() : Infinity;
          return dateA - dateB;
        }
        if (sortBy === "CREATED_AT_DESC") {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        }
        if (sortBy === "CREATED_AT_ASC") {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : Infinity;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : Infinity;
          return dateA - dateB;
        }

        // DEFAULT (Relevance)
        // 1. Cohorts the student is enrolled in first
        if (a.isEnrolled && !b.isEnrolled) return -1;
        if (!a.isEnrolled && b.isEnrolled) return 1;

        // 2. Within each group, In Progress first
        if (a.status === "IN_PROGRESS" && b.status !== "IN_PROGRESS") return -1;
        if (a.status !== "IN_PROGRESS" && b.status === "IN_PROGRESS") return 1;

        // 3. Then cohorts in Enrollment
        if (a.status === "ENROLLMENT" && b.status !== "ENROLLMENT") return -1;
        if (a.status !== "ENROLLMENT" && b.status === "ENROLLMENT") return 1;

        return 0;
      });

  return (
    <>
      {/* Header */}
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between px-4 md:px-8 flex-shrink-0 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MobileMenuButton />
          <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 truncate">
            <Users className="h-5 w-5 md:h-6 md:w-6 text-primary flex-shrink-0" />
            Cohorts
          </h1>
        </div>
        {canManage && (
          <button
            onClick={() => {
              setEditingCohort(null);
              setShowModal(true);
            }}
            className="px-3 md:px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors shadow-sm flex items-center gap-2 hover:shadow-md hover:shadow-primary/20 flex-shrink-0 min-h-[44px]"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create Cohort</span>
            <span className="sm:hidden">New</span>
          </button>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Filters & Sorting */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search cohorts..."
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative w-full sm:w-auto min-w-[140px]">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="appearance-none pl-4 pr-10 py-2.5 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>

                {/* Custom arrow */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
              <div className="relative w-full sm:w-auto min-w-[160px]">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="appearance-none pl-4 pr-10 py-2.5 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all cursor-pointer"
                >
                  <option value="DEFAULT">Sort: Relevant</option>
                  <option value="START_DATE_DESC">Start Date: Newest first</option>
                  <option value="START_DATE_ASC">Start Date: Oldest first</option>
                  <option value="CREATED_AT_DESC">Recently added</option>
                  <option value="CREATED_AT_ASC">Oldest added</option>
                </select>
                
                {/* Custom arrow (inline SVG, no icon library dependency) */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {/* Empty state */}
          {!loading && filteredCohorts.length === 0 && (
            <div className="text-center py-16">
              <Users className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 dark:text-slate-400 font-medium">
                {searchTerm || statusFilter !== "ALL"
                  ? "No cohorts match your filters"
                  : "No cohorts yet"}
              </p>
              {canManage && !searchTerm && statusFilter === "ALL" && (
                <button
                  onClick={() => {
                    setEditingCohort(null);
                    setShowModal(true);
                  }}
                  className="mt-4 px-4 py-2 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-colors"
                >
                  Create your first cohort
                </button>
              )}
            </div>
          )}

          {/* Cohorts grid */}
          <div className="grid gap-4">
            {filteredCohorts.map((cohort, i) => {
              const fillPct =
                cohort.seats > 0
                  ? Math.round(
                      (cohort.totalMembers / cohort.seats) * 100
                    )
                  : 0;

              return (
                <Link
                  key={cohort.id}
                  href={`/cohorts/${cohort.id}`}
                  className={`animate-fade-in stagger-${
                    (i % 5) + 1
                  } group block bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 hover:shadow-md hover:border-primary/30 dark:hover:border-primary/30 transition-all duration-300 hover:-translate-y-0.5`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-base font-semibold text-slate-900 dark:text-white group-hover:text-primary transition-colors">
                          {cohort.title}
                        </h3>
                        <StatusBadge status={cohort.status} />
                        <DeliveryBadge mode={cohort.deliveryMode} />
                        {cohort.instructors && cohort.instructors.length > 0 && (
                          <div className="flex -space-x-2 ml-2">
                             {cohort.instructors.slice(0, 5).map((inst) => (
                               <div 
                                 key={inst.id}
                                 title={inst.name || "Instructor"}
                                 className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 overflow-hidden"
                               >
                                 {inst.image ? (
                                   <img src={inst.image} alt={inst.name || ""} className="w-full h-full object-cover" />
                                 ) : (
                                   inst.name?.[0] || 'I'
                                 )}
                               </div>
                             ))}
                             {cohort.instructors.length > 5 && (
                               <div className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-500 z-10">
                                 +{cohort.instructors.length - 5}
                               </div>
                             )}
                          </div>
                        )}
                      </div>
                      {cohort.description && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-1">
                          {stripHtmlTags(cohort.description)}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-sm text-slate-500 dark:text-slate-400 flex-wrap">
                        {cohort.startDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {new Date(cohort.startDate).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                timeZone: "UTC",
                              }
                            )}
                            {cohort.endDate &&
                              ` — ${new Date(
                                cohort.endDate
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                timeZone: "UTC",
                              })}`}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {cohort.totalMembers}/{cohort.seats} enrolled
                        </span>
                        {cohort.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {cohort.location}
                          </span>
                        )}
                        {cohort._count.groups > 0 && (
                          <span className="text-xs text-slate-400">
                            {cohort._count.groups} group
                            {cohort._count.groups !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      {canManage && (
                        <>
                          <button
                            onClick={(e) => handleEdit(cohort, e)}
                            className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteClick(cohort, e)}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {isStudent && !cohort.isEnrolled && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setJoinCohortId(cohort.id);
                            setJoinCohortTitle(cohort.title);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 shadow-sm hover:shadow-md hover:shadow-primary/20"
                        >
                          <UserPlus className="h-3 w-3" />
                          Join
                        </button>
                      )}
                      {isGuest && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            router.push("/register");
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                        >
                          <LogIn className="h-3 w-3" />
                          Register
                        </button>
                      )}
                      <ArrowRight className="h-5 w-5 text-slate-300 dark:text-slate-600 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">
                        Enrollment
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {fillPct}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(fillPct, 100)}%` }}
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <CohortModal
          cohort={editingCohort}
          onClose={() => {
            setShowModal(false);
            setEditingCohort(null);
          }}
          onSaved={fetchCohorts}
        />
      )}

      {deletingCohort && (
        <DeleteCohortModal
          cohortTitle={deletingCohort.title}
          onClose={() => setDeletingCohort(null)}
          onConfirm={confirmDelete}
        />
      )}

      {/* Join Group Modal */}
      {joinCohortId && (
        <JoinGroupModal
          cohortId={joinCohortId}
          cohortTitle={joinCohortTitle}
          onClose={() => setJoinCohortId(null)}
          onJoined={fetchCohorts}
        />
      )}
    </>
  );
}
