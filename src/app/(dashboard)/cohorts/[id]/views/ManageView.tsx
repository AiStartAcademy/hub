// src/app/(dashboard)/cohorts/[id]/page.tsx

"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef, useMemo, ChangeEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Calendar,
  Clock,
  Video,
  FileText,
  ChevronRight,
  Users as UsersIcon,
  UserPlus,
  Edit3,
  Globe,
  MapPin,
  Monitor,
  Loader2,
  X,
  Plus,
  Trash2,
  DollarSign,
  Copy,
  Layers,
  ArrowLeft,
  Search,
  UserMinus,
  ChevronDown,
  ChevronUp,
  BookOpen,
  CheckCircle,
  LogIn,
  Route,
  Paperclip,
  Link as LinkIcon,
  Download,
  ArrowUp,
  ArrowDown,
  UploadCloud,
  File as FileIcon,
  FileCode, 
  FileImage, 
  FileAudio, 
  FileVideo, 
  FileSpreadsheet, 
  FileJson, 
  FileArchive, 
  LayoutGrid, 
  List, 
  ArrowDownAZ, 
  ArrowUpZA,
  CalendarDays, 
  Key,
  Maximize2,
  Award,
  Play,
  MessageSquare,
  Send,
  MailCheck
} from "lucide-react";
import { RocketChatEmbed } from "@/components/chat/RocketChatEmbed";
import { ChatSignInNotice } from "@/components/chat/ChatSignInNotice";
import { getPrograms } from "../../../courses/actions";
import InstructorCard from "@/components/InstructorCard";
import { LearningPathModal } from "@/components/admin/LearningPathModal";
import { GripVertical, ExternalLink } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";

interface UserBasic {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  roles?: string[];
  bio?: string | null;
}

interface MemberData {
  id: string;
  groupId: string;
  userId: string;
  createdAt: string;
  user: UserBasic;
}

interface GroupData {
  id: string;
  cohortId: string;
  name: string;
  inPerson: boolean;
  price: number;
  seats: number;
  allowOneOnOne: boolean;
  createdAt: string;
  members: MemberData[];
  _count: { members: number };
}

interface SessionData {
  id: string;
  title: string;
  description: string | null;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  meetingLink: string | null;
  recordingLink: string | null;
  order: number;
}

interface LearningPathData {
  id: string;
  title: string;
  description: string | null;
  order: number;
  items: {
    id: string;
    order: number;
    lesson: {
      id: string;
      name: string;
      type: string;
      duration: number;
      module: {
        id: string;
        programId: string;
      };
    };
  }[];
}

interface CohortDetail {
  id: string;
  title: string;
  description: string | null;
  cover: string | null;
  status: string;
  seats: number;
  deliveryMode: string;
  location: string | null;
  zoomLink: string | null;
  startDate: string | null;
  endDate: string | null;
  groups: GroupData[];
  sessions: SessionData[];
  instructors: UserBasic[];
  totalMembers: number;
  completedLessonIds?: string[];
  completedAssessmentIds?: string[];
  learningPaths?: LearningPathData[];
  programs: {
    id: string;
    name: string;
    modules: {
      id: string;
      name: string;
      lessons: { id: string; name: string; type: string; duration: number }[];
      assessments: { id: string; name: string }[];
    }[];
  }[];
  enrollments: { userId: string }[];
  materials?: CohortMaterialData[];
}

interface CohortMaterialData {
  id: string;
  title: string;
  type: string; // 'FILE' | 'LINK'
  url: string;
  order: number;
}

/* ─── Certificate notification (dry-run → confirm) ────────────────────── */

type CertificateNotifyCounts = {
  ok: boolean;
  queued: number;
  alreadyNotified: number;
  revoked: number;
  noEmail: number;
  unsubscribed: number;
  campaignMissing?: boolean;
};

type CertificateNotifyDialogState =
  | { stage: "confirm"; counts: CertificateNotifyCounts }
  | { stage: "success"; counts: CertificateNotifyCounts }
  | { stage: "campaignMissing" };

/** Render an ISO timestamp as a short, locale-friendly date; blank when unparseable. */
function formatShortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Coerce an untrusted payload field into a usable count. */
function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * POST the certificate-notify endpoint. The response is validated field by
 * field rather than trusted, so a partial/renamed payload renders as zeroes
 * instead of `undefined` leaking into the UI.
 */
async function requestCertificateNotifications(
  cohortId: string,
  certificateIds: string[] | undefined,
  dryRun: boolean
): Promise<CertificateNotifyCounts> {
  const body: { certificateIds?: string[]; dryRun: boolean } = { dryRun };
  if (certificateIds !== undefined) body.certificateIds = certificateIds;

  let res: Response;
  try {
    res = await fetch(`/api/admin/cohorts/${cohortId}/certificates/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Bounded wait — an unbounded await here would hang the dialog forever.
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("The request timed out. Please try again.");
    }
    throw new Error("Network error — could not reach the server.");
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error("Server returned an unreadable response.");
  }

  if (!res.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return {
    ok: payload.ok === true,
    queued: toCount(payload.queued),
    alreadyNotified: toCount(payload.alreadyNotified),
    revoked: toCount(payload.revoked),
    noEmail: toCount(payload.noEmail),
    unsubscribed: toCount(payload.unsubscribed),
    campaignMissing: payload.campaignMissing === true,
  };
}

/**
 * Shared dry-run → confirm flow used by both the Certificates panel and the
 * generate modal, so the two entry points cannot drift apart.
 */
function useCertificateNotifier(cohortId: string, onConfirmed: () => void | Promise<void>) {
  const [dialog, setDialog] = useState<CertificateNotifyDialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<{ source: string; message: string } | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  // Ref guard (not state) so a double-click in the same tick cannot fire twice.
  const requestInFlightRef = useRef(false);
  const certificateIdsRef = useRef<string[] | undefined>(undefined);

  const beginRequest = useCallback(() => {
    if (requestInFlightRef.current) return false;
    requestInFlightRef.current = true;
    setIsInFlight(true);
    return true;
  }, []);

  const finishRequest = useCallback(() => {
    requestInFlightRef.current = false;
    setIsInFlight(false);
  }, []);

  const startNotification = useCallback(
    async (source: string, certificateIds?: string[]) => {
      if (!beginRequest()) return;
      setEntryError(null);
      setDialogError(null);
      certificateIdsRef.current = certificateIds;
      try {
        const result = await requestCertificateNotifications(cohortId, certificateIds, true);
        if (result.campaignMissing) {
          setDialog({ stage: "campaignMissing" });
        } else {
          setDialog({ stage: "confirm", counts: result });
        }
      } catch (error) {
        setEntryError({
          source,
          message: error instanceof Error ? error.message : "Could not preview the notification.",
        });
        certificateIdsRef.current = undefined;
      } finally {
        finishRequest();
      }
    },
    [beginRequest, cohortId, finishRequest]
  );

  const confirmNotification = useCallback(async () => {
    if (dialog?.stage !== "confirm") return;
    if (!beginRequest()) return;
    setDialogError(null);
    try {
      const result = await requestCertificateNotifications(cohortId, certificateIdsRef.current, false);
      if (result.campaignMissing) {
        setDialog({ stage: "campaignMissing" });
      } else {
        setDialog({ stage: "success", counts: result });
        await onConfirmed();
      }
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Could not send the notifications.");
    } finally {
      finishRequest();
    }
  }, [beginRequest, cohortId, dialog?.stage, finishRequest, onConfirmed]);

  const closeDialog = useCallback(() => {
    // Refuse to dismiss mid-request so the dialog cannot land in a stale state.
    if (requestInFlightRef.current) return;
    setDialog(null);
    setDialogError(null);
    setEntryError(null);
    certificateIdsRef.current = undefined;
  }, []);

  return { dialog, dialogError, entryError, isInFlight, startNotification, confirmNotification, closeDialog };
}

function CertificateNotifyDialog({
  dialog,
  dialogError,
  isInFlight,
  onConfirm,
  onClose,
}: {
  dialog: CertificateNotifyDialogState | null;
  dialogError: string | null;
  isInFlight: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!dialog) return null;

  const isSuccess = dialog.stage === "success";
  const title =
    dialog.stage === "confirm" ? "Notify students" : isSuccess ? "Students notified" : "Campaign not active";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isSuccess
                  ? "bg-emerald-100 dark:bg-emerald-900/30"
                  : dialog.stage === "campaignMissing"
                  ? "bg-amber-100 dark:bg-amber-900/30"
                  : "bg-purple-100 dark:bg-purple-900/30"
              }`}
            >
              {isSuccess ? (
                <MailCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : dialog.stage === "campaignMissing" ? (
                <Award className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ) : (
                <Send className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              )}
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isInFlight}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {dialog.stage === "confirm" && (
            <>
              {dialog.counts.queued === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">There is nobody left to notify.</p>
              ) : (
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-bold text-slate-900 dark:text-white">{dialog.counts.queued}</span> will be
                  emailed (and texted where they&apos;ve consented),{" "}
                  <span className="font-bold text-slate-900 dark:text-white">{dialog.counts.alreadyNotified}</span>{" "}
                  already notified,{" "}
                  <span className="font-bold text-slate-900 dark:text-white">{dialog.counts.unsubscribed}</span>{" "}
                  of them turned course emails off and will only get a text if they&apos;ve consented.
                </p>
              )}
              {(dialog.counts.revoked > 0 || dialog.counts.noEmail > 0) && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Also skipped: {dialog.counts.revoked} revoked, {dialog.counts.noEmail} without an email address.
                </p>
              )}
            </>
          )}

          {dialog.stage === "success" && (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                {dialog.counts.queued} student{dialog.counts.queued === 1 ? "" : "s"} queued for notification.
              </p>
              <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <li>Already notified: {dialog.counts.alreadyNotified}</li>
                <li>Course emails off (text only): {dialog.counts.unsubscribed}</li>
                <li>Revoked: {dialog.counts.revoked}</li>
                <li>No email: {dialog.counts.noEmail}</li>
              </ul>
            </div>
          )}

          {dialog.stage === "campaignMissing" && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-300">
              Nothing was sent. The <span className="font-bold">&ldquo;Certificate issued&rdquo;</span> campaign is not
              active yet — activate it in Campaigns first, then run Notify students again.
            </div>
          )}

          {dialogError && (
            <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-sm">
              {dialogError}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-6 pt-0">
          {dialog.stage === "confirm" && (
            <>
              <button
                onClick={onClose}
                disabled={isInFlight}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={isInFlight || dialog.counts.queued === 0}
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors shadow-sm shadow-purple-500/20 flex items-center gap-2 disabled:opacity-50"
              >
                {isInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Notify {dialog.counts.queued} student{dialog.counts.queued === 1 ? "" : "s"}
              </button>
            </>
          )}

          {dialog.stage === "campaignMissing" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
              <Link
                href="/admin/contacts/campaigns"
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors shadow-sm flex items-center gap-2"
              >
                Open campaigns
              </Link>
            </>
          )}

          {dialog.stage === "success" && (
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ENROLLMENT: "Enrollment",
  IN_PROGRESS: "In Progress",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  ENROLLMENT: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  IN_PROGRESS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  COMPLETE: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  ARCHIVED: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

const DELIVERY_ICONS: Record<string, React.ComponentType<any>> = {
  INPERSON: MapPin,
  ONLINE: Monitor,
  HYBRID: Globe,
};

const DELIVERY_LABELS: Record<string, string> = {
  INPERSON: "In Person",
  ONLINE: "Online",
  HYBRID: "Hybrid",
};

// === File icon helper ===
const getMaterialIcon = (mat: any, iconClass: string = "h-5 w-5") => {
  if (mat.type === "LINK") return <LinkIcon className={iconClass} />;
  
  const ext = mat.url.split('.').pop()?.toLowerCase() || '';
  
  switch (ext) {
    case 'pdf': return <FileText className={iconClass} />;
    case 'doc': case 'docx': case 'md': case 'txt': return <FileText className={iconClass} />;
    case 'xls': case 'xlsx': case 'csv': return <FileSpreadsheet className={iconClass} />;
    case 'js': case 'ts': case 'jsx': case 'tsx': case 'py': case 'html': case 'css': case 'xml':
      return <FileCode className={iconClass} />;
    case 'json': return <FileJson className={iconClass} />;
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': case 'webp':
      return <FileImage className={iconClass} />;
    case 'mp3': case 'wav': case 'ogg': return <FileAudio className={iconClass} />;
    case 'mp4': case 'webm': case 'mov': return <FileVideo className={iconClass} />;
    case 'zip': case 'rar': case 'tar': case 'gz': return <FileArchive className={iconClass} />;
    default: return <FileIcon className={iconClass} />;
  }
};

const getIconColorClass = (mat: any) => {
  if (mat.type === "LINK") return "bg-sky-50 text-sky-500 dark:bg-sky-900/20 dark:text-sky-400";
  const ext = mat.url.split('.').pop()?.toLowerCase() || '';
  
  switch (ext) {
    case 'pdf': return "bg-rose-50 text-rose-500 dark:bg-rose-900/20 dark:text-rose-400";
    case 'doc': case 'docx': return "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400";
    case 'md': case 'txt': return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    case 'xls': case 'xlsx': case 'csv': return "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400";
    case 'js': case 'ts': case 'py': case 'xml': case 'json':
      return "bg-amber-50 text-amber-500 dark:bg-amber-900/20 dark:text-amber-400";
    case 'jpg': case 'png': case 'svg':
      return "bg-purple-50 text-purple-500 dark:bg-purple-900/20 dark:text-purple-400";
    case 'mp3': case 'mp4': return "bg-pink-50 text-pink-500 dark:bg-pink-900/20 dark:text-pink-400";
    case 'zip': case 'rar': return "bg-orange-50 text-orange-500 dark:bg-orange-900/20 dark:text-orange-400";
    default: return "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
  }
};

// === Force Download Helper ===
const handleForceDownload = async (e: React.MouseEvent, url: string, filename: string) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error("Download failed, falling back to open:", err);
    window.open(url, '_blank');
  }
};

const formatLocalTime = (timeString: string) => {
  if (timeString?.includes('T') && timeString?.includes('Z')) {
    const d = new Date(timeString);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return timeString;
};

// Formats a duration given in seconds
const formatDuration = (seconds: number) => {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

// Computes a call's actual status relative to the current time
const getDynamicStatus = (startTimeStr: string, endTimeStr: string, dbStatus: string) => {
  if (!startTimeStr?.includes('T') || !startTimeStr?.includes('Z')) return dbStatus;
  const now = new Date();
  const start = new Date(startTimeStr);
  const end = new Date(endTimeStr);

  if (now > end) return "completed";
  if (now >= start && now <= end) return "live";
  return "upcoming";
};

/* ─── Group Modal ──────────────────────────────────────────────── */
function GroupModal({
  cohortId,
  group,
  onClose,
  onSaved,
}: {
  cohortId: string;
  group?: GroupData | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: group?.name || "",
    inPerson: group?.inPerson ?? false,
    price: group?.price?.toString() || "0",
    seats: group?.seats?.toString() || "50",
    allowOneOnOne: group?.allowOneOnOne ?? false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = group
        ? `/api/cohorts/${cohortId}/groups/${group.id}`
        : `/api/cohorts/${cohortId}/groups`;
      const method = group ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save group");
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
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {group ? "Edit Group" : "Add Group"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className={labelClass}>Group Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. Morning Group A"
              className={inputClass}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.inPerson}
                  onChange={(e) =>
                    setForm({ ...form, inPerson: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary" />
              </label>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                In Person
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allowOneOnOne}
                  onChange={(e) =>
                    setForm({ ...form, allowOneOnOne: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 dark:peer-focus:ring-primary/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary" />
              </label>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Allow 1:1 sessions
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Price ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Seats (Capacity)</label>
              <input
                type="number"
                min="1"
                value={form.seats}
                onChange={(e) => setForm({ ...form, seats: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

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
              disabled={saving}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 hover:shadow-md hover:shadow-primary/20"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {group ? "Save Changes" : "Add Group"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Add Member Modal ────────────────────────────────────────── */
function AddMemberModal({
  cohortId,
  groupId,
  existingMemberIds,
  onClose,
  onAdded,
}: {
  cohortId: string;
  groupId: string;
  existingMemberIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserBasic[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 1) {
        searchUsers(query.trim());
      } else {
        searchUsers("");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Load all users initially
  useEffect(() => {
    searchUsers("");
  }, []);

  const searchUsers = async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      console.error("Failed to search users");
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (userId: string) => {
    setAdding(userId);
    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }
      );
      if (res.ok) {
        onAdded();
        // Remove from list
        setUsers(users.filter((u) => u.id !== userId));
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add member");
      }
    } catch {
      alert("Something went wrong");
    } finally {
      setAdding(null);
    }
  };

  const availableUsers = users.filter(
    (u) => !existingMemberIds.includes(u.id)
  );
  const inviteEmail = query.trim().toLowerCase();
  const canInvite = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail);

  const handleInvite = async () => {
    const email = inviteEmail;
    setInviting(true);
    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/invites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }
      );
      const data = (await res.json()) as {
        error?: unknown;
        invited?: unknown;
      };
      if (!res.ok) {
        alert(
          typeof data.error === "string"
            ? data.error
            : "Failed to invite member"
        );
        return;
      }

      alert(
        data.invited === true
          ? `Invitation sent to ${email}`
          : `${email} added to the group`
      );
      onAdded();
      onClose();
    } catch {
      alert("Something went wrong");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Add Member to Group
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email..."
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto p-2">
          {searching && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!searching && availableUsers.length === 0 && (
            <div className="text-center py-8">
              <UsersIcon className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {query
                  ? "No users found matching your search"
                  : "All users are already in this group"}
              </p>
              {canInvite && (
                <button
                  type="button"
                  onClick={handleInvite}
                  disabled={inviting}
                  className="mt-4 mx-auto px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-2 disabled:opacity-50 shadow-sm"
                >
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Invite {inviteEmail} to register &amp; join this group
                </button>
              )}
            </div>
          )}

          {!searching &&
            availableUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-sm font-semibold text-primary uppercase overflow-hidden border border-slate-200 dark:border-slate-700">
                    {user.image ? (
                      <img
                        src={user.image}
                        alt={user.name || ""}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      user.name?.[0] || user.email[0]
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {user.name || "Unnamed"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {user.email}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleAdd(user.id)}
                  disabled={adding === user.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                >
                  {adding === user.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <UserPlus className="h-3 w-3" />
                  )}
                  Add
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Instructor Modal ────────────────────────────────────────── */
function InstructorModal({
  query,
  onQueryChange,
  users,
  searching,
  adding,
  onClose,
  onAdd,
  existingInstructorIds,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  users: UserBasic[];
  searching: boolean;
  adding: string | null;
  onClose: () => void;
  onAdd: (userId: string) => void;
  existingInstructorIds: string[];
}) {
  const availableUsers = users.filter((u) => !existingInstructorIds.includes(u.id));

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Assign Instructor</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search by name or email..."
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {searching && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
          {!searching && availableUsers.length === 0 && (
            <div className="text-center py-8">
              <UsersIcon className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">{query ? "No instructors found" : "All available instructors are assigned"}</p>
            </div>
          )}
          {!searching && availableUsers.map((user) => (
            <div key={user.id} className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-semibold text-primary overflow-hidden">
                  {user.image ? <img src={user.image} alt="" className="w-full h-full object-cover" /> : user.name?.[0] || user.email[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{user.name || "Unnamed"}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                </div>
              </div>
              <button
                onClick={() => onAdd(user.id)}
                disabled={adding === user.id}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {adding === user.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Assign
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ProgramSelectorModalProps {
  currentProgramIds: string[];
  onClose: () => void;
  onSelect: (programIds: string[]) => void;
}

function ProgramSelectorModal({
  currentProgramIds,
  onClose,
  onSelect,
}: ProgramSelectorModalProps) {
  const [programs, setPrograms] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(currentProgramIds);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPrograms().then((data) => {
      setPrograms(data);
      setLoading(false);
    });
  }, []);

  const toggleProgram = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in text-slate-900 dark:text-white">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold">Link Programs</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            programs.map((p) => {
              const isSelected = selectedIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggleProgram(p.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-slate-200 dark:border-slate-700 hover:border-primary/50"
                  }`}
                >
                  <div className="flex-1 pr-4">
                    {/* Only show 'Recordings' inside the cohort context if it matches the pattern */}
                    <p className="text-sm font-bold">
                      {p.name.startsWith("Recordings (") ? "Recordings" : p.name}
                    </p>
                    <p className="text-xs text-slate-500 line-clamp-1">
                      {p.description || "No description"}
                    </p>
                  </div>
                  <div
                    className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-primary border-primary text-white"
                        : "border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    {isSelected && <CheckCircle className="h-3 w-3" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(selectedIds)}
            className="px-6 py-2 rounded-lg text-sm font-bold text-white bg-primary hover:bg-primary-dark transition-all shadow-lg shadow-primary/20"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Instructor Slots Modal ──────────────────────────────────────── */
interface SlotData {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  isBooked: boolean;
  instructor?: any;
  booking?: any;
}

const WEEKDAYS = [
  { key: 0, label: "Sun" },
  { key: 1, label: "Mon" },
  { key: 2, label: "Tue" },
  { key: 3, label: "Wed" },
  { key: 4, label: "Thu" },
  { key: 5, label: "Fri" },
  { key: 6, label: "Sat" },
];

function InstructorSlotsModal({
  cohortId,
  groupId,
  onClose,
}: {
  cohortId: string;
  groupId: string;
  onClose: () => void;
}) {
  const [slots, setSlots] = useState<SlotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Weekly schedule state
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [timeSlots, setTimeSlots] = useState<{ startTime: string; endTime: string }[]>([
    { startTime: "10:00", endTime: "10:30" },
  ]);
  const [weeks, setWeeks] = useState(2);

  useEffect(() => {
    fetchSlots();
  }, [groupId]);

  const fetchSlots = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/slots`
      );
      if (res.ok) {
        const data = await res.json();
        setSlots(data);
      }
    } catch (error) {
      console.error("Failed to fetch slots:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const addTimeSlot = () => {
    setTimeSlots((prev) => [...prev, { startTime: "", endTime: "" }]);
  };

  const removeTimeSlot = (index: number) => {
    setTimeSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTimeSlot = (index: number, field: "startTime" | "endTime", value: string) => {
    setTimeSlots((prev) =>
      prev.map((ts, i) => (i === index ? { ...ts, [field]: value } : ts))
    );
  };

  // Generate dates for selected weekdays over the next N weeks
  const generateDates = (): string[] => {
    const dates: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let w = 0; w < weeks; w++) {
      for (const day of selectedDays) {
        const date = new Date(today);
        // Find next occurrence of this weekday
        const diff = (day - today.getDay() + 7) % 7;
        date.setDate(today.getDate() + diff + w * 7);
        // Skip dates in the past
        if (date >= today) {
          dates.push(date.toISOString().split("T")[0]);
        }
      }
    }

    return [...new Set(dates)].sort();
  };

  const formatTime = (time24: string): string => {
    if (!time24) return "";
    const [h, m] = time24.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  };

  const handleGenerate = async () => {
    if (selectedDays.length === 0) {
      alert("Select at least one day of the week");
      return;
    }

    const validTimeSlots = timeSlots.filter((ts) => ts.startTime && ts.endTime);
    if (validTimeSlots.length === 0) {
      alert("Add at least one time slot");
      return;
    }

    const dates = generateDates();
    if (dates.length === 0) {
      alert("No dates generated. Try increasing the number of weeks.");
      return;
    }

    setAdding(true);
    let created = 0;
    let errors = 0;

    for (const date of dates) {
      for (const ts of validTimeSlots) {
        try {
          const res = await fetch(
            `/api/cohorts/${cohortId}/groups/${groupId}/slots`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                date,
                startTime: formatTime(ts.startTime),
                endTime: formatTime(ts.endTime),
                timezone: "UTC",
              }),
            }
          );
          if (res.ok) {
            created++;
          } else {
            errors++;
          }
        } catch {
          errors++;
        }
      }
    }

    setAdding(false);
    fetchSlots();

    if (created > 0) {
      alert(`Created ${created} slot${created > 1 ? "s" : ""}${errors > 0 ? ` (${errors} skipped — already exist or failed)` : ""}`);
    } else {
      alert("No slots created. They may already exist.");
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    if (!confirm("Delete this slot?")) return;

    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/slots/${slotId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        fetchSlots();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete slot");
      }
    } catch (error) {
      alert("Something went wrong");
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all";

  // Group slots by date for display
  const slotsByDate = slots.reduce<Record<string, SlotData[]>>((acc, slot) => {
    const dateKey = new Date(slot.date).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(slot);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[85vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            My Availability Slots
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Weekly schedule form */}
          <div className="space-y-4 pb-5 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Set Weekly Schedule
            </h3>

            {/* Days of week */}
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                Days of the week
              </label>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((wd) => (
                  <button
                    key={wd.key}
                    type="button"
                    onClick={() => toggleDay(wd.key)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                      selectedDays.includes(wd.key)
                        ? "bg-primary text-white shadow-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {wd.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Time slots */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Time slots
                </label>
                <button
                  type="button"
                  onClick={addTimeSlot}
                  className="text-xs font-medium text-primary hover:text-primary-dark transition-colors flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Add time
                </button>
              </div>
              <div className="space-y-2">
                {timeSlots.map((ts, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={ts.startTime}
                      onChange={(e) => updateTimeSlot(i, "startTime", e.target.value)}
                      className={inputClass}
                    />
                    <span className="text-xs text-slate-400 shrink-0">to</span>
                    <input
                      type="time"
                      value={ts.endTime}
                      onChange={(e) => updateTimeSlot(i, "endTime", e.target.value)}
                      className={inputClass}
                    />
                    {timeSlots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTimeSlot(i)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Weeks ahead */}
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                Generate for next
              </label>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWeeks(w)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                      weeks === w
                        ? "bg-primary text-white shadow-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {w} week{w > 1 ? "s" : ""}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            {selectedDays.length > 0 && timeSlots.some((ts) => ts.startTime && ts.endTime) && (
              <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                Will create{" "}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {generateDates().length * timeSlots.filter((ts) => ts.startTime && ts.endTime).length} slots
                </span>{" "}
                across {generateDates().length} dates
              </div>
            )}

            {/* Generate button */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={adding || selectedDays.length === 0}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {adding && <Loader2 className="h-4 w-4 animate-spin" />}
              {adding ? "Creating slots..." : "Generate Slots"}
            </button>
          </div>

          {/* Existing slots list */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Existing Slots ({slots.length})
            </h3>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : slots.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No slots yet. Set your weekly schedule above.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(slotsByDate).map(([dateLabel, dateSlots]) => (
                  <div key={dateLabel}>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                      {dateLabel}
                    </p>
                    <div className="space-y-1">
                      {dateSlots.map((slot) => (
                        <div
                          key={slot.id}
                          className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-900 dark:text-white">
                              {slot.startTime} — {slot.endTime}
                            </span>
                            {slot.isBooked && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                Booked
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteSlot(slot.id)}
                            disabled={slot.isBooked}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Student Booking Modal ──────────────────────────────────────── */
function StudentBookingModal({
  cohortId,
  groupId,
  onClose,
  onBooked,
}: {
  cohortId: string;
  groupId: string;
  onClose: () => void;
  onBooked?: () => void;
}) {
  const [slots, setSlots] = useState<SlotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetchSlots();
  }, [groupId]);

  const fetchSlots = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/slots`
      );
      if (res.ok) {
        const data = await res.json();
        // Show slots that are not booked and don't have a pending booking
        setSlots(data.filter((s: any) =>
          !s.isBooked && (!s.booking || s.booking.status === "REJECTED" || s.booking.status === "CANCELLED")
        ));
      }
    } catch (error) {
      console.error("Failed to fetch slots:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleBooking = async () => {
    if (!selectedSlot) {
      alert("Please select a slot");
      return;
    }

    setBooking(true);
    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/bookings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slotId: selectedSlot,
            studentNote: note || null,
          }),
        }
      );
      if (res.ok) {
        alert("Request sent! The instructor will review and provide a meeting link.");
        onBooked?.();
        onClose();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to book");
      }
    } catch (error) {
      alert("Something went wrong");
    } finally {
      setBooking(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md max-h-[80vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Book One-on-One Session
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : slots.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No available slots
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {slots.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => setSelectedSlot(slot.id)}
                    className={`w-full text-left p-4 rounded-lg border transition-all ${
                      selectedSlot === slot.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-slate-200 dark:border-slate-700 hover:border-primary/50"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {new Date(slot.date).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {slot.startTime} - {slot.endTime} ({slot.timezone})
                    </p>
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Tell the instructor why you want this session..."
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                  rows={3}
                />
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleBooking}
            disabled={booking || !selectedSlot || slots.length === 0}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {booking && <Loader2 className="h-4 w-4 animate-spin" />}
            Book
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Booking Management Modal ──────────────────────────────────────── */
interface BookingData {
  id: string;
  status: string;
  slotId: string;
  studentId: string;
  student: UserBasic;
  slot: SlotData;
  studentNote?: string;
  meetingLink?: string;
}

function BookingManagementModal({
  cohortId,
  groupId,
  onClose,
  onUpdated,
}: {
  cohortId: string;
  groupId: string;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [bookings, setBookings] = useState<BookingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);
  const [approvingLink, setApprovingLink] = useState("");
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");

  useEffect(() => {
    fetchBookings();
  }, [groupId]);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/bookings`
      );
      if (res.ok) {
        const data = await res.json();
        setBookings(data);
      }
    } catch (error) {
      console.error("Failed to fetch bookings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (bookingId: string) => {
    if (!approvingLink.trim()) {
      alert("Please enter meeting link");
      return;
    }

    setApproving(bookingId);
    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/bookings/${bookingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "APPROVED",
            meetingLink: approvingLink,
          }),
        }
      );
      if (res.ok) {
        setApprovingLink("");
        fetchBookings();
        onUpdated?.();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to approve");
      }
    } catch (error) {
      alert("Something went wrong");
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (bookingId: string) => {
    if (!confirm("Reject this booking request?")) return;

    try {
      const res = await fetch(
        `/api/cohorts/${cohortId}/groups/${groupId}/bookings/${bookingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "REJECTED" }),
        }
      );
      if (res.ok) {
        fetchBookings();
        onUpdated?.();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to reject");
      }
    } catch (error) {
      alert("Something went wrong");
    }
  };

  const filteredBookings = bookings.filter((b) => b.status.toLowerCase() === tab);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Session Requests
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-200 dark:border-slate-700 px-6">
          {(["pending", "approved", "rejected"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              }`}
            >
              {t === "pending"
                ? "Pending"
                : t === "approved"
                  ? "Approved"
                  : "Rejected"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No {tab} bookings
              </p>
            </div>
          ) : (
            filteredBookings.map((booking) => (
              <div
                key={booking.id}
                className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {booking.student.name || booking.student.email}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(booking.slot.date).toLocaleDateString()} at{" "}
                    {booking.slot.startTime}
                  </p>
                </div>

                {booking.studentNote && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                    "{booking.studentNote}"
                  </p>
                )}

                {tab === "pending" && (
                  <div className="space-y-2">
                    <input
                      type="url"
                      placeholder="Meeting link (Zoom, Google Meet, etc.)"
                      value={approvingLink}
                      onChange={(e) => setApprovingLink(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(booking.id)}
                        disabled={approving === booking.id || !approvingLink}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(booking.id)}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-white bg-rose-500 hover:bg-rose-600 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {tab === "approved" && booking.meetingLink && (
                  <a
                    href={booking.meetingLink?.startsWith("http") ? booking.meetingLink : `https://${booking.meetingLink}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
                  >
                    <Video className="h-3 w-3" />
                    Join Meeting
                  </a>
                )}
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── View All Materials Modal ────────────────────────────────────── */
function ViewMaterialsModal({
  materials,
  onClose,
}: {
  materials: any[];
  onClose: () => void;
}) {
  const [viewMode, setViewMode] = useState<"GRID" | "LIST">("GRID");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"ORDER" | "NAME_ASC" | "NAME_DESC" | "NEWEST" | "OLDEST">("ORDER");

  // Filter and sort
  const filteredAndSorted = materials
    .filter((m) => m.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "NAME_ASC") return a.title.localeCompare(b.title);
      if (sortBy === "NAME_DESC") return b.title.localeCompare(a.title);
      if (sortBy === "NEWEST") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "OLDEST") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return a.order - b.order; // Default (ORDER)
    });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-5xl h-[85vh] flex flex-col animate-fade-in">
        
        {/* Header & Controls */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Paperclip className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Cohort Materials</h2>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{materials.length} Items</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files..."
                className="pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm w-48 focus:outline-none focus:border-primary transition-all"
              />
            </div>
            
            {/* Sort */}
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button 
                onClick={() => setSortBy("ORDER")} 
                title="Custom Order"
                className={`p-1.5 rounded-md ${sortBy === 'ORDER' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500'}`}
              ><Key className="h-4 w-4" /></button>
              
              <button 
                onClick={() => setSortBy(sortBy === "NAME_ASC" ? "NAME_DESC" : "NAME_ASC")} 
                title="Sort by Name"
                className={`p-1.5 rounded-md ${sortBy.startsWith('NAME') ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500'}`}
              >
                {sortBy === "NAME_DESC" ? <ArrowUpZA className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
              </button>
              
              <button 
                onClick={() => setSortBy(sortBy === "NEWEST" ? "OLDEST" : "NEWEST")} 
                title="Sort by Date"
                className={`p-1.5 rounded-md flex items-center ${sortBy === 'NEWEST' || sortBy === 'OLDEST' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500'}`}
              >
                <CalendarDays className="h-4 w-4" />
                {sortBy === "OLDEST" ? <ArrowUp className="h-3 w-3 -ml-0.5" /> : <ArrowDown className="h-3 w-3 -ml-0.5" />}
              </button>
            </div>

            {/* View Mode */}
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 mr-2">
              <button 
                onClick={() => setViewMode("GRID")} 
                className={`p-1.5 rounded-md ${viewMode === 'GRID' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500'}`}
              ><LayoutGrid className="h-4 w-4" /></button>
              <button 
                onClick={() => setViewMode("LIST")} 
                className={`p-1.5 rounded-md ${viewMode === 'LIST' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500'}`}
              ><List className="h-4 w-4" /></button>
            </div>

            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 dark:bg-slate-900">
          {filteredAndSorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <Search className="h-12 w-12 mb-3 opacity-20" />
              <p>No materials found</p>
            </div>
          ) : viewMode === "GRID" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredAndSorted.map((mat) => (
                <div 
                  key={mat.id} 
                  className="group relative flex flex-col bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:shadow-xl hover:-translate-y-1 transition-all overflow-hidden cursor-pointer"
                  onClick={() => window.open(mat.url, '_blank')}
                >
                  <div className={`h-24 flex items-center justify-center ${getIconColorClass(mat)} opacity-80 group-hover:opacity-100 transition-opacity`}>
                    {getMaterialIcon(mat, "h-10 w-10")}
                  </div>
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 line-clamp-2 leading-snug break-words">
                      {mat.title}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {mat.type === "LINK" ? "LINK" : mat.url.split('.').pop()?.substring(0, 4)}
                      </span>
                      {mat.type === "FILE" && (
                        <button 
                          onClick={(e) => handleForceDownload(e, mat.url, mat.title)}
                          className="p-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-emerald-500 hover:text-white rounded-lg text-slate-500 transition-colors"
                        >
                          <Download className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2 max-w-4xl mx-auto">
              {filteredAndSorted.map((mat) => (
                <div 
                  key={mat.id}
                  onClick={() => window.open(mat.url, '_blank')}
                  className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-primary/50 hover:shadow-md cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-4">
                    <div className={`w-10 h-10 flex-shrink-0 rounded-lg flex items-center justify-center ${getIconColorClass(mat)}`}>
                      {getMaterialIcon(mat)}
                    </div>
                    <div className="truncate">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-primary transition-colors truncate">
                        {mat.title}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {mat.type === "LINK" ? "External Link" : `File • ${new Date(mat.createdAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  {mat.type === "FILE" && (
                    <button 
                      onClick={(e) => handleForceDownload(e, mat.url, mat.title)}
                      className="p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-emerald-500 hover:border-emerald-500 hover:text-white rounded-lg text-slate-500 transition-all flex-shrink-0"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Material Modal ──────────────────────────────────────────────── */
function MaterialModal({
  cohortId,
  cohortTitle,
  onClose,
  onSaved,
}: {
  cohortId: string;
  cohortTitle: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [tab, setTab] = useState<"FILE" | "LINK" | "TEXT">("FILE");

  // States for FILE tab
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // States for LINK tab
  const [linkTitle, setLinkTitle] = useState("");
  const [url, setUrl] = useState("");

  // States for TEXT tab (pasted text → saved as a .md file material)
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files!)]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      if (tab === "FILE") {
        if (files.length === 0) return alert("Please select at least one file");
        
        const safeCohortName = cohortTitle
          .toLowerCase()
          .replace(/[^a-z0-9а-яё]+/g, '-')
          .replace(/(^-|-$)/g, '');

        // Upload files sequentially to avoid a race when computing maxOrder
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setUploadProgress(`Uploading ${i + 1} of ${files.length}...`);

          const formData = new FormData();
          formData.append("file", file);
          formData.append("uploadPath", `cohorts/${safeCohortName}/materials`);

          console.log(`[MaterialModal] Uploading file: ${file.name}`);
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });

          if (!uploadRes.ok) {
            const err = await uploadRes.json();
            throw new Error(`Failed to upload ${file.name}: ${err.error}`);
          }

          const uploadData = await uploadRes.json();

          console.log(`[MaterialModal] Saving ${file.name} to database...`);
          const dbRes = await fetch(`/api/cohorts/${cohortId}/materials`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: file.name, // File name becomes the title
              type: "FILE",
              url: uploadData.url,
            }),
          });

          if (!dbRes.ok) {
            const err = await dbRes.json();
            throw new Error(`Failed to save ${file.name} context: ${err.error}`);
          }
        }
      } else if (tab === "TEXT") {
        if (!textTitle.trim()) return alert("Title is required");
        if (!textBody.trim()) return alert("Text is required");

        const safeCohortName = cohortTitle
          .toLowerCase()
          .replace(/[^a-z0-9а-яё]+/g, '-')
          .replace(/(^-|-$)/g, '');
        const safeTitle = textTitle
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9а-яё]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'note';

        // Pasted text is stored as a markdown file so it behaves like any uploaded material
        const textFile = new File([textBody], `${safeTitle}.md`, { type: "text/markdown" });
        const formData = new FormData();
        formData.append("file", textFile);
        formData.append("uploadPath", `cohorts/${safeCohortName}/materials`);

        setUploadProgress("Saving text...");
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(`Failed to save text: ${err.error}`);
        }
        const uploadData = await uploadRes.json();

        const dbRes = await fetch(`/api/cohorts/${cohortId}/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: textTitle.trim(),
            type: "FILE",
            url: uploadData.url,
          }),
        });
        if (!dbRes.ok) {
          const err = await dbRes.json();
          throw new Error(err.error || "Failed to save text material");
        }
      } else {
        if (!linkTitle.trim()) return alert("Title is required");
        if (!url.trim()) return alert("URL is required");

        let finalUrl = url;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          finalUrl = "https://" + url;
        }

        const res = await fetch(`/api/cohorts/${cohortId}/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: linkTitle.trim(),
            type: "LINK",
            url: finalUrl,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save link");
        }
      }

      onSaved();
      onClose();
    } catch (err: any) {
      alert(err.message || "Something went wrong");
    } finally {
      setSaving(false);
      setUploadProgress("");
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all";
  const labelClass = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md animate-fade-in flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Add Material</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="px-6 pt-4 flex-shrink-0">
          <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${tab === "FILE" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500"}`}
              onClick={() => setTab("FILE")}
            >
              Upload Files
            </button>
            <button
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${tab === "LINK" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500"}`}
              onClick={() => setTab("LINK")}
            >
              Add Link
            </button>
            <button
              type="button"
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${tab === "TEXT" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500"}`}
              onClick={() => setTab("TEXT")}
            >
              Paste Text
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-5 overflow-y-auto">
            {tab === "FILE" ? (
              <div className="space-y-4">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors relative cursor-pointer
                    ${isDragging 
                      ? "border-primary bg-primary/5" 
                      : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                >
                  <input
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <UploadCloud className={`h-8 w-8 mx-auto mb-3 transition-colors ${isDragging ? "text-primary" : "text-slate-400"}`} />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Click to select or drag and drop files
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Upload multiple PDFs, docs, or images at once
                  </p>
                </div>

                {files.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Selected files ({files.length})
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                      {files.map((f, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                              {f.name}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {(f.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(i)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-md transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : tab === "TEXT" ? (
              <div className="space-y-5">
                <div>
                  <label className={labelClass}>Title *</label>
                  <input
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    required
                    placeholder="e.g. Session 3 Notes"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Text *</label>
                  <textarea
                    value={textBody}
                    onChange={(e) => setTextBody(e.target.value)}
                    required
                    rows={10}
                    placeholder="Paste notes, prompts, instructions, or any text here. Markdown is fine."
                    className={`${inputClass} font-mono text-xs leading-relaxed resize-y min-h-[160px]`}
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Saved as a Markdown (.md) file students can open or download.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label className={labelClass}>Title *</label>
                  <input
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    required
                    placeholder="e.g. Reference Documentation"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>URL *</label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                    placeholder="https://docs.google.com/..."
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl">
            <span className="text-xs font-medium text-primary animate-pulse">
              {uploadProgress}
            </span>
            <button
              type="submit"
              disabled={saving || (tab === "FILE" && files.length === 0) || (tab === "TEXT" && !textBody.trim())}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {tab === "FILE" ? "Upload & Save All" : tab === "TEXT" ? "Save Text" : "Add Link"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Sortable Material Item ────────────────────────────────────────── */
function SortableMaterialItem({
  mat,
  canManage,
  onDelete,
}: {
  mat: any;
  canManage: boolean;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: mat.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-stretch justify-between rounded-xl border transition-all group overflow-hidden bg-white dark:bg-slate-900 ${
        isDragging
          ? "border-primary shadow-lg opacity-90 scale-[1.02]"
          : "border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/50 hover:shadow-md"
      }`}
    >
      {/* Drag handle (left) */}
      {canManage && (
        <div
          {...attributes}
          {...listeners}
          className="flex items-center px-2 bg-slate-50 dark:bg-slate-800/50 text-slate-300 hover:text-primary cursor-grab active:cursor-grabbing outline-none border-r border-slate-100 dark:border-slate-800"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      {/* Clickable center area (opens the file/link) */}
      <div 
        className="flex items-center gap-3 min-w-0 pr-4 flex-1 cursor-pointer p-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
        onClick={() => window.open(mat.url, '_blank')}
        title="Click to open"
      >
        <div className={`w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center ${getIconColorClass(mat)}`}>
          {getMaterialIcon(mat)}
        </div>
        <div className="truncate">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
            {mat.title}
          </p>
          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 truncate mt-0.5">
            {mat.type === "LINK" ? "External Link" : mat.url.split('.').pop()?.toUpperCase() || "FILE"}
          </p>
        </div>
      </div>

      {/* Action buttons (right) */}
      <div className="flex items-center gap-1 flex-shrink-0 p-3">
        {mat.type === "LINK" ? (
          <a
            href={mat.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()} // avoid a double click
            className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:text-sky-400 dark:hover:bg-sky-900/20 transition-colors"
            title="Open link"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <button
            onClick={(e) => handleForceDownload(e, mat.url, mat.title)}
            className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:text-emerald-400 dark:hover:bg-emerald-900/20 transition-colors"
            title="Download file"
          >
            <Download className="h-4 w-4" />
          </button>
        )}

        {canManage && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(mat.id); }}
            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-900/20 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Generate Certificates Modal ────────────────────────────────────── */
function GenerateCertificatesModal({
  cohort,
  onClose,
  onFinished,
}: {
  cohort: CohortDetail;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  
  // Which groups are expanded (all by default)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(cohort.groups?.map(g => g.id) || [])
  );
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<{ userId: string; name: string; status: "success" | "skipped" | "error"; msg: string; certificateId?: string }[]>([]);

  // Only successful (non-skipped) generations that actually returned an id.
  const generatedCertificateIds = useMemo(
    () => logs.filter((l) => l.status === "success" && l.certificateId).map((l) => l.certificateId as string),
    [logs]
  );
  const notifier = useCertificateNotifier(cohort.id, onFinished);

  const userMap = new Map<string, { id: string; name: string; email: string }>();
  cohort.groups?.forEach((g) => {
    g.members?.forEach((m) => {
      userMap.set(m.user.id, { id: m.user.id, name: m.user.name || "Unknown", email: m.user.email });
    });
  });
  const allStudents = Array.from(userMap.values());

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/admin/certificate-templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
        if (data.length > 0 && !selectedTemplate) setSelectedTemplate(data[0].id);
        else if (data.length === 0) setSelectedTemplate("");
      }
    } catch (err) {
      console.error("Failed to load templates", err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    setSelectedUserIds(new Set(allStudents.map(s => s.id)));
  }, []);

    const handleTemplateUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.html')) {
        alert("Only HTML files are allowed.");
        return;
    }

    const name = window.prompt("Enter a shiny name for this certificate template:");
    if (!name) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
    }

    setUploadingTemplate(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name);

    try {
      const res = await fetch("/api/admin/certificate-templates", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        await fetchTemplates();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to upload template");
      }
    } catch (err) {
      alert("Upload failed");
    } finally {
      setUploadingTemplate(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) return;
    if (!confirm("Are you sure you want to permanently delete this template?")) return;
    
    try {
      const res = await fetch(`/api/admin/certificate-templates/${selectedTemplate}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSelectedTemplate("");
        await fetchTemplates();
        alert("Template successfully deleted.");
      } else {
        alert("Failed to delete template");
      }
    } catch (err) {
      alert("Delete failed");
    }
  };

  const toggleGroupExpand = (groupId: string) => {
    const next = new Set(expandedGroups);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setExpandedGroups(next);
  };

  const toggleUser = (userId: string) => {
    const next = new Set(selectedUserIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedUserIds(next);
  };

  const toggleGroup = (groupId: string, selectAll: boolean) => {
    const group = cohort.groups?.find(g => g.id === groupId);
    if (!group) return;
    
    const next = new Set(selectedUserIds);
    group.members.forEach(m => {
      if (selectAll) next.add(m.user.id);
      else next.delete(m.user.id);
    });
    setSelectedUserIds(next);
  };

  const startGeneration = async () => {
    if (!selectedTemplate) return alert("Select a template");
    if (selectedUserIds.size === 0) return alert("Select at least one student");
    
    setIsGenerating(true);
    setIsCompleted(false);
    setProgress(0);
    setLogs([]);

    const userIdsArray = Array.from(selectedUserIds);
    const BATCH_SIZE = 2;

    for (let i = 0; i < userIdsArray.length; i += BATCH_SIZE) {
      const batch = userIdsArray.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (uid) => {
        const user = userMap.get(uid);
        try {
          const res = await fetch("/api/admin/certificates/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: uid,
              cohortId: cohort.id,
              templateId: selectedTemplate,
            }),
          });
          
          const data = await res.json();
          if (res.ok) {
            setLogs(prev => [{
               userId: uid, name: user?.name!, 
               status: data.skipped ? "skipped" : "success", 
               msg: data.skipped ? "Already emitted" : "Generated successfully",
               certificateId: data.certificate?.id
            }, ...prev]);
          } else {
            setLogs(prev => [{ userId: uid, name: user?.name!, status: "error", msg: data.error || "Failed" }, ...prev]);
          }
        } catch (err) {
            setLogs(prev => [{ userId: uid, name: user?.name!, status: "error", msg: "Network error" }, ...prev]);
        }
      }));
      
      setProgress(Math.round((Math.min(i + batch.length, userIdsArray.length) / userIdsArray.length) * 100));
    }
    
    setIsGenerating(false);
    setIsCompleted(true);
    onFinished();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[85vh] flex flex-col animate-fade-in">
        
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Award className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Issue Certificates</h2>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{cohort.title}</p>
            </div>
          </div>
          {!isGenerating && (
            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
              <X className="h-5 w-5 text-slate-500" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-6 space-y-6">
          
          {/* Top Config row */}
          <div className="flex-shrink-0 space-y-2">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Select Template (.html)</label>
            <div className="flex items-center gap-2">
                {loadingTemplates ? (
                <div className="flex-1 px-3 py-2 flex items-center gap-2 text-sm text-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates...</div>
                ) : (
                <select 
                    value={selectedTemplate} 
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    disabled={isGenerating || templates.length === 0}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all disabled:opacity-50"
                >
                    {templates.length === 0 && <option value="">No templates available</option>}
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                )}
                
                {/* Template management */}
                <input 
                    type="file" 
                    accept=".html" 
                    ref={fileInputRef} 
                    onChange={handleTemplateUpload} 
                    className="hidden" 
                />
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  disabled={isGenerating || uploadingTemplate}
                  title="Upload new HTML template to GCS"
                  className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                    {uploadingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    <span className="hidden sm:inline">Add New</span>
                </button>
                <button 
                  onClick={handleDeleteTemplate} 
                  disabled={isGenerating || !selectedTemplate}
                  title="Delete selected template"
                  className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-900/30 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            </div>
          </div>

          {/* User List by Groups */}
          <div className="flex-1 min-h-0 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden flex flex-col">
             
             {isGenerating || isCompleted ? (
               <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                 <div className="flex justify-between items-end mb-1">
                    {isCompleted ? (
                      <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                        <CheckCircle className="h-5 w-5" /> All Certificates Processed!
                      </span>
                    ) : (
                      <span className="text-base font-bold text-slate-900 dark:text-white">Generating...</span>
                    )}
                    <span className={`text-lg font-bold ${isCompleted ? 'text-emerald-600' : 'text-primary'}`}>{progress}%</span>
                 </div>
                 <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-300 ease-out ${isCompleted ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${progress}%` }} />
                 </div>
                 
                 <div className="mt-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 min-h-[200px] space-y-2">
                   {logs.map((log, index) => (
                     <div key={index} className="flex items-start gap-2 text-xs">
                       {log.status === 'success' && <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />}
                       {log.status === 'skipped' && <CheckCircle className="h-4 w-4 text-slate-400 shrink-0" />}
                       {log.status === 'error' && <X className="h-4 w-4 text-rose-500 shrink-0" />}
                       <div>
                         <span className="font-semibold text-slate-700 dark:text-slate-300">{log.name}: </span>
                         <span className={log.status === 'error' ? 'text-rose-500' : 'text-slate-500'}>{log.msg}</span>
                       </div>
                     </div>
                   ))}
                   {logs.length === 0 && <p className="text-xs text-slate-400 italic">Processing started...</p>}
                 </div>

                 {isCompleted && (
                   <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
                     {generatedCertificateIds.length === 0 ? (
                       <p className="text-xs text-slate-500 dark:text-slate-400">
                         No newly generated certificates to notify about — everyone in this batch was skipped or failed.
                       </p>
                     ) : (
                       <>
                         <div className="flex items-center gap-3 flex-wrap">
                           <button
                             onClick={() => notifier.startNotification("generate-modal", generatedCertificateIds)}
                             disabled={notifier.isInFlight}
                             className="px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors shadow-sm shadow-purple-500/20 flex items-center gap-2 disabled:opacity-50"
                           >
                             {notifier.isInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                             Notify now ({generatedCertificateIds.length})
                           </button>
                           <p className="text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-[12rem]">
                             Emails the new certificate holders, and texts those who consented.
                           </p>
                         </div>
                         {notifier.entryError?.source === "generate-modal" && (
                           <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-xs">
                             {notifier.entryError.message}
                           </div>
                         )}
                       </>
                     )}
                   </div>
                 )}
               </div>
             ) : (
                <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {cohort.groups?.length === 0 && (
                        <div className="p-6 text-center text-sm text-slate-500">No groups/students found in this cohort.</div>
                    )}
                    {cohort.groups?.map((group) => {
                        const isExpanded = expandedGroups.has(group.id);
                        
                        return (
                            <div key={group.id} className="bg-white dark:bg-slate-800/50">
                                {/* Group Header Row - CLICKABLE */}
                                <div 
                                    onClick={() => toggleGroupExpand(group.id)}
                                    className="px-4 py-3 flex items-center justify-between bg-slate-50/90 dark:bg-slate-800/90 sticky top-0 z-10 border-b border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                                        <Layers className="h-4 w-4 text-slate-400" />
                                        <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{group.name}</span>
                                        <span className="text-xs text-slate-500">({group.members.length})</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); toggleGroup(group.id, true); }} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Select All</button>
                                        <button onClick={(e) => { e.stopPropagation(); toggleGroup(group.id, false); }} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Clear</button>
                                    </div>
                                </div>
                                {/* Members (collapsible) */}
                                {isExpanded && (
                                  <div className="divide-y divide-slate-50 dark:divide-slate-800/30">
                                      {group.members.length === 0 && (
                                          <div className="px-4 py-3 text-xs text-slate-400 italic">No members in this group</div>
                                      )}
                                      {group.members.map((m) => (
                                          <label key={m.user.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                              <input 
                                                type="checkbox" 
                                                checked={selectedUserIds.has(m.user.id)}
                                                onChange={() => toggleUser(m.user.id)}
                                                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                              />
                                              <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500 overflow-hidden border border-slate-200 dark:border-slate-600">
                                                  {m.user.image ? <img src={m.user.image} alt="" className="w-full h-full object-cover"/> : m.user.name?.[0] || 'U'}
                                                </div>
                                                <div>
                                                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-tight">{m.user.name || "Unknown"}</p>
                                                  <p className="text-[10px] text-slate-500">{m.user.email}</p>
                                                </div>
                                              </div>
                                          </label>
                                      ))}
                                  </div>
                                )}
                            </div>
                        )
                    })}
                </div>
             )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-shrink-0 p-4 border-t border-slate-200 dark:border-slate-700 justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl">
           <span className="text-sm font-semibold text-slate-500">
              Selected: <span className="text-slate-900 dark:text-white">{selectedUserIds.size}</span>
           </span>
           <div className="flex gap-2">
            {!isGenerating && (
                <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                Close
                </button>
            )}
            <button
                onClick={startGeneration}
                disabled={isGenerating || selectedUserIds.size === 0 || templates.length === 0}
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 shadow-purple-500/20"
            >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {isGenerating ? "Generating..." : "Generate Batch"}
            </button>
           </div>
        </div>
      </div>
      <CertificateNotifyDialog
        dialog={notifier.dialog}
        dialogError={notifier.dialogError}
        isInFlight={notifier.isInFlight}
        onConfirm={notifier.confirmNotification}
        onClose={notifier.closeDialog}
      />
    </div>
  );
}

/* ─── Certificates List Modal (For Admins) ────────────────────────────── */
function CertificatesListModal({
  certificates,
  onClose,
  onPreview,
  onDelete,
}: {
  certificates: any[];
  onClose: () => void;
  onPreview: (url: string) => void;
  onDelete: (certId: string) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[85vh] flex flex-col animate-fade-in">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Award className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Issued Certificates</h2>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{certificates.length} Total</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {certificates.length === 0 ? (
            <div className="text-center py-10">
              <Award className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No certificates issued yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl">
              {certificates.map((cert) => (
                <div key={cert.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500 overflow-hidden border border-slate-200 dark:border-slate-600 shrink-0">
                      {cert.user?.image ? <img src={cert.user?.image} alt="" className="w-full h-full object-cover"/> : cert.user?.name?.[0] || 'U'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{cert.user?.name || "Unknown"}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest">ID: <span className="font-mono text-slate-500 dark:text-slate-400">{cert.id}</span></p>
                      <div className="mt-1">
                        {cert.notifiedAt ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            <MailCheck className="h-3 w-3" />
                            Notified {formatShortDate(cert.notifiedAt)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            Not notified
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      onClick={(e) => handleForceDownload(e, cert.pdfUrl, `${cert.user?.name || 'Certificate'}.pdf`)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-sm"
                    >PDF</button>
                    <button 
                      onClick={() => onPreview(cert.pngUrl)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 transition-colors shadow-sm"
                    >PNG</button>
                    
                    {/* Divider and delete button */}
                    <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 ml-3 mr-1"></div>
                    <button
                      onClick={() => onDelete(cert.id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-900/20 transition-colors"
                      title="Revoke and delete certificate"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Cohort Chat Modal ────────────────────────────────────────── */
type CohortChatTokenData = {
  authToken: string | null;
  channelName: string;
  chatUrl: string;
};

function isCohortChatTokenData(value: unknown): value is CohortChatTokenData {
  if (typeof value !== "object" || value === null) return false;

  const data = value as Record<string, unknown>;
  return (
    (typeof data.authToken === "string" || data.authToken === null) &&
    typeof data.channelName === "string" &&
    typeof data.chatUrl === "string"
  );
}

function useCohortChatToken(cohortId: string | null): {
  tokenData: CohortChatTokenData | null;
  loading: boolean;
  error: string;
} {
  const [result, setResult] = useState<{
    cohortId: string;
    tokenData: CohortChatTokenData | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    if (!cohortId) return;

    // Narrowed local: TS does not carry the null check into the async closure below.
    const activeCohortId = cohortId;
    const controller = new AbortController();
    let cancelled = false;

    async function fetchToken(): Promise<void> {
      try {
        const response = await fetch(`/api/cohorts/${activeCohortId}/chat`, {
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        const apiError = typeof data === "object" && data !== null && "error" in data
          ? data.error
          : null;

        if (!response.ok || apiError) {
          throw new Error(typeof apiError === "string" ? apiError : "Failed to load chat");
        }
        if (!isCohortChatTokenData(data)) {
          throw new Error("Chat returned an invalid response");
        }
        if (!cancelled) {
          setResult({ cohortId: activeCohortId, tokenData: data, error: "" });
        }
      } catch (fetchError) {
        if (!cancelled) {
          setResult({
            cohortId: activeCohortId,
            tokenData: null,
            error: fetchError instanceof Error ? fetchError.message : "Failed to load chat",
          });
        }
      }
    }

    void fetchToken();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cohortId]);

  if (!cohortId) return { tokenData: null, loading: false, error: "" };
  if (!result || result.cohortId !== cohortId) {
    return { tokenData: null, loading: true, error: "" };
  }
  return { tokenData: result.tokenData, loading: false, error: result.error };
}

function CohortChatModal({
  cohort,
  onClose,
}: {
  cohort: CohortDetail;
  onClose: () => void;
}) {
  const { tokenData, loading, error } = useCohortChatToken(cohort.id);

  return (
    // No padding on mobile so the chat fills the screen
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center sm:p-4 animate-fade-in">
      {/* w-[95vw] h-[95vh] on desktop, full screen on mobile */}
      <div className="bg-white dark:bg-slate-900 sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full h-full sm:w-[95vw] sm:h-[95vh] max-w-[1600px] flex flex-col overflow-hidden">
        
        {/* Compact modal header: RocketChat renders its own header inside */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <MessageSquare className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-tight">Messages Workspace</h2>
              <p className="text-[10px] sm:text-xs text-slate-500 truncate">{cohort.title} & Direct Messages</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors">
            <X className="h-5 w-5 sm:h-6 sm:w-6 text-slate-500" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 w-full relative bg-slate-50 dark:bg-slate-950 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 dark:bg-slate-900/50 z-10 backdrop-blur-sm">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Connecting to secure chat...</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-slate-900 z-10 p-6 text-center">
              <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 p-4 rounded-xl text-sm font-medium border border-rose-200 dark:border-rose-800 max-w-md">
                <p className="font-bold mb-1">Connection failed</p>
                {error}
              </div>
            </div>
          )}
          {tokenData && (
            // No padding so the iframe fits exactly
            <div className="w-full h-full">
              {tokenData.authToken ? (
                <RocketChatEmbed
                  chatUrl={tokenData.chatUrl}
                  authToken={tokenData.authToken}
                  channelName={tokenData.channelName}
                />
              ) : (
                <ChatSignInNotice chatUrl={tokenData.chatUrl} channelName={tokenData.channelName} compact />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CohortChatPanel({
  cohort,
  onExpand,
}: {
  cohort: CohortDetail;
  onExpand: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hasEnteredView, setHasEnteredView] = useState(() => typeof IntersectionObserver === "undefined");
  const { tokenData, loading, error } = useCohortChatToken(hasEnteredView ? cohort.id : null);

  useEffect(() => {
    if (hasEnteredView) return;

    const panel = panelRef.current;
    if (!panel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setHasEnteredView(true);
        observer.disconnect();
      }
    });

    observer.observe(panel);
    return () => observer.disconnect();
  }, [hasEnteredView]);

  return (
    <div ref={panelRef} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in stagger-1">
      <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
            <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Cohort Chat</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Announcements and discussion for everyone in this cohort.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 transition-colors"
          title="Open full screen"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="h-[560px] relative bg-slate-50 dark:bg-slate-950 overflow-hidden">
        {(!hasEnteredView || loading) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 dark:bg-slate-900/50 z-10 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Connecting to secure chat...</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-slate-900 z-10 p-6 text-center">
            <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 p-4 rounded-xl text-sm font-medium border border-rose-200 dark:border-rose-800 max-w-md">
              <p className="font-bold mb-1">Connection failed</p>
              {error}
            </div>
          </div>
        )}
        {tokenData && !tokenData.authToken && (
          <ChatSignInNotice chatUrl={tokenData.chatUrl} channelName={tokenData.channelName} compact />
        )}
        {tokenData?.authToken && (
          <RocketChatEmbed
            chatUrl={tokenData.chatUrl}
            authToken={tokenData.authToken}
            channelName={tokenData.channelName}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Main Detail Page ───────────────────────────────────────────── */
export default function CohortDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [cohort, setCohort] = useState<CohortDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<GroupData | null>(null);
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showInstructorModal, setShowInstructorModal] = useState(false);
  const [instructorQuery, setInstructorQuery] = useState("");
  const [instructors, setFoundInstructors] = useState<UserBasic[]>([]);
  const [searchingInstructors, setSearchingInstructors] = useState(false);
  const [addingInstructor, setAddingInstructor] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showInstructorSlotsModal, setShowInstructorSlotsModal] = useState(false);
  const [selectedGroupForSlots, setSelectedGroupForSlots] = useState<string | null>(null);
  const [showStudentBookingModal, setShowStudentBookingModal] = useState(false);
  const [selectedGroupForBooking, setSelectedGroupForBooking] = useState<string | null>(null);
  const [showBookingManagementModal, setShowBookingManagementModal] = useState(false);
  const [selectedGroupForRequests, setSelectedGroupForRequests] = useState<string | null>(null);
  const [myApprovedSessions, setMyApprovedSessions] = useState<any[]>([]);
  const [showProgramModal, setShowProgramModal] = useState(false);
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [showPathModal, setShowPathModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false); // Chat modal state
  const [leavingGroupId, setLeavingGroupId] = useState<string | null>(null);
  const [showCompletedSessions, setShowCompletedSessions] = useState(false);
  const [showUpcomingSessions, setShowUpcomingSessions] = useState(true);
  const [nextSessionText, setNextSessionText] = useState<{ isLive: boolean; text: string } | null>(null);
  // Wall clock for the join-link pick below; refreshed by the same minute timer as nextSessionText.
  const [nowMs, setNowMs] = useState<number | null>(null);

  const [isCurriculumExpanded, setIsCurriculumExpanded] = useState(false);
  const [isMaterialsExpanded, setIsMaterialsExpanded] = useState(false);
  const [materialsExpanded, setMaterialsExpanded] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [showAllMaterialsModal, setShowAllMaterialsModal] = useState(false);
  const [reordering, setReordering] = useState(false);

  const [showCertificateModal, setShowCertificateModal] = useState(false);
  const [showCertificatesListModal, setShowCertificatesListModal] = useState(false);
  const [issuedCertificates, setIssuedCertificates] = useState<any[]>([]);
  
  // Image preview state
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const fetchCertificates = useCallback(async () => {
    try {
      const res = await fetch(`/api/cohorts/${params.id}/certificates`);
      if (res.ok) {
        const data = await res.json();
        setIssuedCertificates(data);
      }
    } catch (e) {
      console.error(e);
    }
  }, [params.id]);

  const cohortNotifier = useCertificateNotifier(String(params.id), fetchCertificates);

  const handleDeleteCertificate = async (certId: string) => {
    if (!confirm("Are you sure you want to permanently delete this certificate?")) return;
    try {
      const res = await fetch(`/api/cohorts/${params.id}/certificates/${certId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchCertificates();
      } else {
        alert("Failed to delete certificate");
      }
    } catch {
      alert("Error deleting certificate");
    }
  };

  useEffect(() => {
    fetchCertificates();
  }, [fetchCertificates]);

  // DnD Sensors config
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Reorder logic
  const handleDragEndMaterials = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !cohort?.materials) return;

    const sortedMaterials = [...cohort.materials].sort((a, b) => a.order - b.order);
    const oldIndex = sortedMaterials.findIndex((m) => m.id === active.id);
    const newIndex = sortedMaterials.findIndex((m) => m.id === over.id);

    const reordered = arrayMove(sortedMaterials, oldIndex, newIndex).map((item, idx) => ({
      ...item,
      order: idx,
    }));

    setCohort({ ...cohort, materials: reordered });
    setReordering(true);

    try {
      const payload = reordered.map((m) => ({ id: m.id, order: m.order }));
      const res = await fetch(`/api/cohorts/${cohort.id}/materials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      
      if (!res.ok) {
        console.error("Failed to save new order to DB");
        fetchCohort();
      }
    } catch (e) {
      console.error(e);
      fetchCohort();
    } finally {
      setReordering(false);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!confirm("Are you sure you want to delete this material?")) return;
    try {
      const res = await fetch(`/api/cohorts/${cohort?.id}/materials/${materialId}`, { method: "DELETE" });
      if (res.ok) fetchCohort();
      else alert("Failed to delete material");
    } catch (e) {
      console.error(e);
    }
  };

  const togglePathExpanded = (pathId: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathId)) next.delete(pathId);
      else next.add(pathId);
      return next;
    });
  };

  useEffect(() => {
    if (!cohort?.sessions) return;

    const updateTimer = () => {
      const now = new Date();
      setNowMs(now.getTime());
      const upcoming = [...cohort.sessions]
        .filter((s) => s.startTime && s.endTime && new Date(s.endTime).getTime() >= now.getTime())
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (upcoming.length === 0) {
        setNextSessionText(null);
        return;
      }

      const nextItem = upcoming[0];
      const start = new Date(nextItem.startTime);
      const end = new Date(nextItem.endTime);

      if (now >= start && now <= end) {
        setNextSessionText({ isLive: true, text: "Live now" });
        return;
      }

      const diffMs = start.getTime() - now.getTime();
      if (diffMs <= 0) {
        setNextSessionText(null);
        return;
      }

      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      let text = "in ";
      if (diffDays > 0) {
        text += `${diffDays}d ${diffHours}h`;
      } else if (diffHours > 0) {
        text += `${diffHours}h ${diffMins}m`;
      } else {
        text += `${diffMins}m`;
      }

      setNextSessionText({ isLive: false, text });
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 60000);
    return () => clearInterval(intervalId);
  }, [cohort]);

  const toggleProgramExpanded = (programId: string) => {
    setExpandedPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });
  };

  const userRole = (session?.user as any)?.role || "GUEST";
  const userId = (session?.user as any)?.id;
  const canManage = hasAnyRole(session?.user, MANAGE_ROLES);
  const canSendCohortMessage = hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"]);
  const isGuest = userRole === "GUEST";
  const isInAnyGroup = userId
    ? (cohort?.groups?.some(g => g.members?.some(m => m.userId === userId)) ?? false)
    : false;
  const isEnrolled = isInAnyGroup || canManage;
  // The link students should join: the next upcoming session's own link
  // (custom or borrowed from another cohort), else the cohort's Zoom link.
  // A session "ends" at its ISO endTime, or an hour after `date` when endTime
  // is a bare clock string (MCP-created rows).
  const joinLink = useMemo(() => {
    if (nowMs === null) return null;
    const now = nowMs;
    const endOf = (s: SessionData) => {
      const iso = s.endTime?.includes("T") ? new Date(s.endTime).getTime() : NaN;
      return Number.isNaN(iso) ? new Date(s.date).getTime() + 60 * 60 * 1000 : iso;
    };
    const next = [...(cohort?.sessions ?? [])]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .find((s) => endOf(s) > now);
    return next?.meetingLink ?? cohort?.zoomLink ?? null;
  }, [cohort?.sessions, cohort?.zoomLink, nowMs]);
  const isStudentNotEnrolled = userRole === "STUDENT" && !isInAnyGroup;
  const showRegisterButton = isGuest;

  const handleJoinGroup = async (groupId: string, price: number) => {
    if (price > 0) {
      router.push(`/cohorts/${params.id}/pay/${groupId}`);
      return;
    }
    setJoining(groupId);
    try {
      const res = await fetch(`/api/cohorts/${params.id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      if (res.ok) {
        fetchCohort();
        setShowJoinModal(false);
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

  const handleLeaveGroup = async (groupId: string) => {
    setLeavingGroupId(groupId);
    try {
      const res = await fetch(`/api/groups/${groupId}/leave`, {
        method: "POST",
      });
      if (res.ok) {
        setShowLeaveConfirm(false);
        fetchCohort();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to leave group");
      }
    } catch {
      alert("Something went wrong");
    } finally {
      setLeavingGroupId(null);
    }
  };

  const fetchCohort = useCallback(async (skipCache = false) => {
    try {
      const url = new URL(`/api/cohorts/${params.id}`, window.location.origin);
      if (skipCache) {
        url.searchParams.set("_t", Date.now().toString());
      }
      const res = await fetch(url.toString(), {
        cache: "no-store"
      });
      if (res.ok) {
        const data = await res.json();
        setCohort(data);
      }
    } catch (error) {
      console.error("Failed to fetch cohort", error);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  const fetchMyApprovedSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/me/one-on-one-sessions");
      if (res.ok) {
        const data = await res.json();
        setMyApprovedSessions(data);
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    }
  }, []);

  useEffect(() => {
    fetchCohort();
    fetchMyApprovedSessions();
  }, [fetchCohort, fetchMyApprovedSessions]);

  useEffect(() => {
    let refetchTimeout: NodeJS.Timeout;
    const handleVisibilityChange = () => {
      if (!document.hidden) fetchCohort(true);
    };
    const handleFocus = () => {
      refetchTimeout = setTimeout(() => fetchCohort(true), 300);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      clearTimeout(refetchTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchCohort]);

  useEffect(() => {
    if (document.hidden) return;
    const interval = setInterval(() => {
      if (!document.hidden) fetchCohort(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchCohort]);

  useEffect(() => {
    const autoGroupId = searchParams.get("groupId");
    if (!autoGroupId || !session?.user || !cohort) return;
    const userRole = (session.user as any)?.role || "GUEST";
    if (userRole !== "STUDENT") return;
    const userId = (session.user as any)?.id;
    const alreadyIn = cohort.groups?.some(
      (g: any) => g.id === autoGroupId && g.members?.some((m: any) => m.userId === userId)
    );
    if (alreadyIn) {
      const url = new URL(window.location.href);
      url.searchParams.delete("groupId");
      router.replace(url.pathname + (url.search !== "?" ? url.search : ""));
      return;
    }
    const group = cohort.groups?.find((g: any) => g.id === autoGroupId);
    if (!group || group.price > 0) return;
    fetch(`/api/cohorts/${params.id}/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: autoGroupId }),
    }).then((res) => {
      if (res.ok || res.status === 409) fetchCohort();
    }).finally(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("groupId");
      router.replace(url.pathname + (url.search !== "?" ? url.search : ""));
    });
  }, [searchParams, session, cohort, params.id, fetchCohort, router]);

  // Stripe checkout return: the `checkout` query param drives the notice banner
  // (derived at render, no mirrored state). On success, refresh enrollment; then
  // auto-clear the param after a few seconds.
  const clearCheckoutParam = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("guest");
    router.replace(url.pathname + (url.search !== "?" ? url.search : ""));
  }, [router]);

  useEffect(() => {
    const status = searchParams.get("checkout");
    if (status !== "success" && status !== "cancelled") return;
    if (status === "success") fetchCohort();
    const t = setTimeout(clearCheckoutParam, 6000);
    return () => clearTimeout(t);
  }, [searchParams, fetchCohort, clearCheckoutParam]);

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("Delete this group?")) return;
    try {
      const res = await fetch(`/api/cohorts/${params.id}/groups/${groupId}`, { method: "DELETE" });
      if (res.ok) fetchCohort();
    } catch {
      alert("Failed to delete group");
    }
  };

  const handleRemoveMember = async (groupId: string, memberId: string) => {
    if (!confirm("Remove this member from the group?")) return;
    try {
      const res = await fetch(`/api/cohorts/${params.id}/groups/${groupId}/members/${memberId}`, { method: "DELETE" });
      if (res.ok) fetchCohort();
    } catch {
      alert("Failed to remove member");
    }
  };

  const toggleGroupExpanded = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (instructorQuery.trim().length >= 1) searchInstructors(instructorQuery.trim());
      else if (showInstructorModal) searchInstructors("");
    }, 300);
    return () => clearTimeout(timer);
  }, [instructorQuery, showInstructorModal]);

  const searchInstructors = async (q: string) => {
    setSearchingInstructors(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data: UserBasic[] = await res.json();
        setFoundInstructors(data.filter(u => hasAnyRole(u, ["INSTRUCTOR", "ADMIN"])));
      }
    } catch {
      console.error("Failed to search instructors");
    } finally {
      setSearchingInstructors(false);
    }
  };

  const handleAddInstructor = async (instructorId: string) => {
    setAddingInstructor(instructorId);
    try {
      const res = await fetch(`/api/cohorts/${params.id}/instructors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructorId }),
      });
      if (res.ok) fetchCohort();
      else {
        const data = await res.json();
        alert(data.error || "Failed to add instructor");
      }
    } catch {
      alert("Something went wrong");
    } finally {
      setAddingInstructor(null);
    }
  };

  const handleRemoveInstructor = async (instructorId: string) => {
    if (!confirm("Remove this instructor?")) return;
    try {
      const res = await fetch(`/api/cohorts/${params.id}/instructors?instructorId=${instructorId}`, { method: "DELETE" });
      if (res.ok) fetchCohort();
    } catch {
      alert("Failed to remove instructor");
    }
  };

  const handleUpdateProgram = async (programIds: string[]) => {
    try {
      const res = await fetch(`/api/cohorts/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programIds }),
      });
      if (res.ok) {
        fetchCohort();
        setShowProgramModal(false);
      } else {
        alert("Failed to update program");
      }
    } catch {
      alert("Something went wrong");
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!cohort) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 dark:text-slate-400 text-lg">Cohort not found</p>
          <Link href="/cohorts" className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to Cohorts
          </Link>
        </div>
      </div>
    );
  }

  const seatsLeft = cohort.seats - cohort.totalMembers;
  const fillPct = cohort.seats > 0 ? Math.round((cohort.totalMembers / cohort.seats) * 100) : 0;
  const DeliveryIcon = DELIVERY_ICONS[cohort.deliveryMode] || Globe;

  return (
    <>
      {(searchParams.get("checkout") === "success" ||
        searchParams.get("checkout") === "cancelled") && (
        <div
          className={`fixed top-4 right-4 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${
            searchParams.get("checkout") === "success"
              ? "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300"
              : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
          }`}
        >
          {searchParams.get("checkout") === "success" ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <X className="h-5 w-5" />
          )}
          <span>
            {searchParams.get("checkout") === "success"
              ? searchParams.get("guest") === "1"
                ? "Payment received — we're finalizing your seat. Check your email to set up access."
                : "Payment received — we're finalizing your enrollment."
              : "Checkout cancelled."}
          </span>
          <button
            onClick={clearCheckoutParam}
            className="ml-1 opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 px-4 md:px-8 py-4 flex-shrink-0">
        {/* Breadcrumb row */}
        <div className="flex items-center gap-2 mb-1.5">
          <MobileMenuButton />
          <nav className="text-sm font-medium text-slate-500 dark:text-slate-400">
            <ol className="list-none p-0 inline-flex items-center">
              <li className="flex items-center">
                <Link href="/cohorts" className="hover:text-primary transition-colors">Cohorts</Link>
                <ChevronRight className="h-4 w-4 mx-2 text-slate-300 dark:text-slate-600" />
              </li>
              <li className="text-slate-900 dark:text-white font-semibold truncate max-w-[160px] sm:max-w-xs">
                {cohort.title}
              </li>
            </ol>
          </nav>
        </div>

        {/* Title + actions row */}
        <div className="flex items-start justify-between gap-3 mt-1 flex-wrap">
          <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
            {cohort.title}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[cohort.status] || STATUS_STYLES.DRAFT}`}>
              {cohort.status === "IN_PROGRESS" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />}
              {STATUS_LABELS[cohort.status] || cohort.status}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              <DeliveryIcon className="h-3 w-3" />
              {DELIVERY_LABELS[cohort.deliveryMode] || cohort.deliveryMode}
            </span>
          </h1>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {cohort.instructors.length > 0 && (
              <div className="flex -space-x-2">
                {cohort.instructors.map((inst) => (
                  <div key={inst.id} title={inst.name || "Instructor"} className="w-8 h-8 rounded-full border-2 border-white dark:border-slate-900 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500 overflow-hidden">
                    {inst.image ? <img src={inst.image} alt={inst.name || ""} className="w-full h-full object-cover" /> : inst.name?.[0] || 'I'}
                  </div>
                ))}
              </div>
            )}
            {(isStudentNotEnrolled || showRegisterButton || canManage || isEnrolled) && (
              <div className="flex items-center gap-2 flex-wrap">
                
                {/* Open-chat button (responsive) */}
                {isEnrolled && (
                  <button 
                    onClick={() => document.getElementById("cohort-chat")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="px-3 sm:px-4 py-2 border border-blue-200 dark:border-blue-800/50 rounded-lg text-sm font-semibold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors shadow-sm focus:ring-2 focus:ring-blue-500/20 gap-2 min-h-[44px] flex items-center justify-center"
                    aria-label="Open Messages"
                  >
                    <MessageSquare className="h-4 w-4 sm:h-4 sm:w-4 shrink-0" />
                    {/* Desktop label */}
                    <span className="hidden sm:inline">Messages</span>
                    {/* Mobile label */}
                    <span className="sm:hidden">Chat</span>
                  </button>
                )}

                {isStudentNotEnrolled && (
                  <button onClick={() => setShowJoinModal(true)} className="px-3 md:px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-dark transition-colors shadow-sm hover:shadow-md hover:shadow-primary/20 flex items-center gap-2 min-h-[44px]">
                    <UserPlus className="h-4 w-4" />
                    <span className="hidden sm:inline">Join Cohort</span>
                    <span className="sm:hidden">Join</span>
                  </button>
                )}
                {showRegisterButton && (
                  <Link href={`/register?callbackUrl=/cohorts/${params.id}`} className="px-3 md:px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 min-h-[44px]">
                    <LogIn className="h-4 w-4" />
                    <span className="hidden sm:inline">Register to Join</span>
                    <span className="sm:hidden">Register</span>
                  </Link>
                )}
                {canManage && (
                  <>
                    {canSendCohortMessage && (
                      <Link href={`/admin/cohorts/${cohort?.id ?? params.id}/messages`} title="Email or text everyone in this cohort" className="px-3 md:px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 min-h-[44px]">
                        <MailCheck className="h-4 w-4" />
                        <span className="hidden sm:inline">Message cohort</span>
                      </Link>
                    )}
                    <Link href={`/cohorts/${params.id}/edit`} className="px-3 md:px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 min-h-[44px]">
                      <Edit3 className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit Cohort</span>
                    </Link>
                    <Link href="/cohorts" className="px-3 md:px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 min-h-[44px]">
                      <ArrowLeft className="h-4 w-4" />
                      <span className="hidden sm:inline">Back</span>
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LEFT COLUMN */}
          <div className="lg:col-span-2 space-y-6">
            {/* Cover Image */}
            {cohort.cover && (
              <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-700/50 animate-fade-in">
                <img src={cohort.cover} alt={cohort.title} className="w-full h-48 object-cover" />
              </div>
            )}

            {/* Description */}
            {cohort.description && (
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-3">Description</h2>
                <div
                  className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed [&_p]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900 [&_h3]:dark:text-white [&_h3]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-slate-900 [&_h4]:dark:text-white [&_h4]:mt-4 [&_h4]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_li]:mb-1 [&_strong]:text-slate-900 [&_strong]:dark:text-white"
                  dangerouslySetInnerHTML={{ __html: cohort.description }}
                />
              </div>
            )}

            {/* Groups Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in stagger-2">
              <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700/50 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" /> Groups {cohort.groups.length > 0 && <span className="text-sm font-normal text-slate-400">({cohort.groups.length})</span>}
                </h2>
                {canManage && (
                  <button onClick={() => { setEditingGroup(null); setShowGroupModal(true); }} className="px-3 py-1.5 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-colors flex items-center gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add Group
                  </button>
                )}
              </div>

              {cohort.groups.length === 0 ? (
                <div className="p-8 text-center">
                  <Layers className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 dark:text-slate-400">No groups yet</p>
                  {canManage && <button onClick={() => { setEditingGroup(null); setShowGroupModal(true); }} className="mt-3 text-sm text-primary hover:underline">Create the first group</button>}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {cohort.groups.map((group) => {
                    const isExpanded = expandedGroups.has(group.id);
                    const memberCount = group._count?.members || group.members?.length || 0;
                    return (
                      <div key={group.id}>
                        {/* Group header row */}
                        <div className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors cursor-pointer" onClick={() => toggleGroupExpanded(group.id)}>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/10 to-accent/10 dark:from-primary/20 dark:to-accent/20 flex items-center justify-center">
                              <Layers className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{group.name}</h3>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                  <UsersIcon className="h-2.5 w-2.5" /> {memberCount}/{group.seats}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${group.inPerson ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"}`}>
                                  {group.inPerson ? <MapPin className="h-2.5 w-2.5" /> : <Monitor className="h-2.5 w-2.5" />} {group.inPerson ? "In Person" : "Online"}
                                </span>
                                <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                  {group.price > 0 ? `$${group.price.toFixed(2)}` : "Free"}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            {canManage && (
                              <>
                                <button onClick={(e) => { e.stopPropagation(); setAddMemberGroupId(group.id); }} className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors" title="Add Member"><UserPlus className="h-4 w-4" /></button>
                                <button onClick={(e) => { e.stopPropagation(); setEditingGroup(group); setShowGroupModal(true); }} className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit"><Edit3 className="h-4 w-4" /></button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors" title="Delete"><Trash2 className="h-4 w-4" /></button>
                                {group.allowOneOnOne && (
                                  <>
                                    <button onClick={(e) => { e.stopPropagation(); setSelectedGroupForSlots(group.id); setShowInstructorSlotsModal(true); }} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" title="Manage your availability slots">
                                      <Clock className="h-3.5 w-3.5 inline mr-1" /> My Slots
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setSelectedGroupForRequests(group.id); setShowBookingManagementModal(true); }} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" title="Manage booking requests">
                                      <CheckCircle className="h-3.5 w-3.5 inline mr-1" /> Requests
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                            
                            {group.allowOneOnOne && userId && !canManage && group.members?.some(m => m.userId === userId) && (
                              <button onClick={(e) => { e.stopPropagation(); setSelectedGroupForBooking(group.id); setShowStudentBookingModal(true); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors flex items-center gap-1.5 shadow-sm">
                                <Calendar className="h-3 w-3" /> Book 1:1 Session
                              </button>
                            )}

                            {isStudentNotEnrolled && group.seats > memberCount && (
                              group.price > 0 ? (
                                <button onClick={(e) => { e.stopPropagation(); handleJoinGroup(group.id, group.price); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-1.5 shadow-sm">
                                  <DollarSign className="h-3 w-3" /> Pay & Join
                                </button>
                              ) : (
                                <button onClick={(e) => { e.stopPropagation(); handleJoinGroup(group.id, group.price); }} disabled={joining === group.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm">
                                  {joining === group.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Join Free
                                </button>
                              )
                            )}

                            {showRegisterButton && group.seats > memberCount && (
                              group.price > 0 ? (
                                <Link href={`/cohorts/${params.id}/pay/${group.id}`} onClick={(e) => e.stopPropagation()} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-1.5 shadow-sm">
                                  <DollarSign className="h-3 w-3" /> Checkout
                                </Link>
                              ) : (
                                <Link href={`/register?callbackUrl=/cohorts/${params.id}&groupId=${group.id}`} onClick={(e) => e.stopPropagation()} className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5">
                                  <LogIn className="h-3 w-3" /> Register
                                </Link>
                              )
                            )}

                            {userId && !canManage && group.members?.some(m => m.userId === userId) && (
                              <button onClick={(e) => { e.stopPropagation(); setLeavingGroupId(group.id); setShowLeaveConfirm(true); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 transition-colors flex items-center gap-1.5 shadow-sm">
                                <UserMinus className="h-3 w-3" /> Leave Group
                              </button>
                            )}

                            {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400 ml-1" /> : <ChevronDown className="h-4 w-4 text-slate-400 ml-1" />}
                          </div>
                        </div>

                        {/* Student's approved 1:1 sessions */}
                        {group.allowOneOnOne && userId && !canManage && (() => {
                          const groupSessions = myApprovedSessions.filter((s: any) => s.group?.id === group.id);
                          if (groupSessions.length === 0) return null;
                          return (
                            <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-emerald-50/50 dark:bg-emerald-900/10">
                              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-2">My Approved Sessions</p>
                              <div className="space-y-1.5">
                                {groupSessions.map((s: any) => (
                                  <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800/50">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-slate-900 dark:text-white">{new Date(s.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} &middot; {s.startTime} — {s.endTime}</p>
                                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">with {s.instructor?.name || s.instructor?.email}</p>
                                    </div>
                                    {s.meetingLink && (
                                      <a href={s.meetingLink.startsWith("http") ? s.meetingLink : `https://${s.meetingLink}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-3 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors flex items-center gap-1.5 shrink-0">
                                        <Video className="h-3 w-3" /> Join
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Expanded members section */}
                        {isExpanded && (
                          <div className="px-6 pb-4 bg-slate-50/30 dark:bg-slate-800/10">
                            {group.members.length === 0 ? (
                              <div className="py-4 text-center">
                                <p className="text-xs text-slate-400">No members yet</p>
                                {canManage && <button onClick={() => setAddMemberGroupId(group.id)} className="mt-2 text-xs text-primary hover:underline inline-flex items-center gap-1"><UserPlus className="h-3 w-3" /> Add the first member</button>}
                              </div>
                            ) : (
                              <div className="space-y-1 pt-1">
                                {group.members.map((member) => (
                                  <div key={member.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-center gap-3">
                                      <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-semibold text-slate-500 uppercase overflow-hidden border border-slate-200 dark:border-slate-600">
                                        {member.user.image ? <img src={member.user.image} alt={member.user.name || ""} className="w-full h-full object-cover" /> : member.user.name?.[0] || member.user.email[0]}
                                      </div>
                                      <div>
                                        <p className="text-xs font-medium text-slate-900 dark:text-white">{member.user.name || "Unnamed"}</p>
                                        {(canManage || member.userId === userId) && <p className="text-[11px] text-slate-400">{member.user.email}</p>}
                                      </div>
                                    </div>
                                    {canManage && <button onClick={() => handleRemoveMember(group.id, member.id)} className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors" title="Remove from group"><UserMinus className="h-3.5 w-3.5" /></button>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Materials & Documents Section */}
            {(isEnrolled || canManage) && (
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in stagger-1">
                <div 
                  className="flex items-center justify-between p-6 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                  onClick={() => setIsMaterialsExpanded(!isMaterialsExpanded)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                      <Paperclip className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Cohort Materials</h2>
                        {isMaterialsExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {cohort.materials?.length || 0} Documents & Links
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {cohort.materials && cohort.materials.length > 0 && (
                      <button onClick={() => setShowAllMaterialsModal(true)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/20 transition-colors" title="Open File Browser">
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    )}
                    {canManage && (
                      <button onClick={() => { setIsMaterialsExpanded(true); setShowMaterialModal(true); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 shadow-sm">
                        <Plus className="h-3.5 w-3.5" /> Add Material
                      </button>
                    )}
                  </div>
                </div>

                {isMaterialsExpanded && (
                  <div className="px-6 pb-6 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {!cohort.materials || cohort.materials.length === 0 ? (
                      <div className="py-6 text-center border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/20">
                        <Paperclip className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                        <p className="text-sm text-slate-400">No materials uploaded yet.</p>
                      </div>
                    ) : (
                      <>
                        <div className={`space-y-2 relative transition-all ${reordering ? 'opacity-50 pointer-events-none' : ''}`}>
                          {(() => {
                            const sortedMaterials = [...cohort.materials].sort((a, b) => a.order - b.order);
                            const displayedMaterials = materialsExpanded ? sortedMaterials : sortedMaterials.slice(0, 4);

                            return (
                              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEndMaterials}>
                                <SortableContext items={displayedMaterials.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                                  {displayedMaterials.map((mat) => <SortableMaterialItem key={mat.id} mat={mat} canManage={canManage} onDelete={handleDeleteMaterial} />)}
                                </SortableContext>
                              </DndContext>
                            );
                          })()}
                        </div>
                        
                        {cohort.materials.length > 4 && (
                          <button onClick={() => setMaterialsExpanded(!materialsExpanded)} className="w-full mt-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-400 rounded-lg transition-colors flex items-center justify-center gap-1">
                            {materialsExpanded ? <><ChevronUp className="h-3.5 w-3.5" /> Show less</> : <><ChevronDown className="h-3.5 w-3.5" /> View all {cohort.materials.length} resources</>}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Courses & Learning Paths */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in stagger-1">
              <div className="flex items-center justify-between p-6 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors" onClick={() => setIsCurriculumExpanded(!isCurriculumExpanded)}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                    <BookOpen className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Curriculum</h2>
                      {isCurriculumExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {cohort.programs?.length || cohort.learningPaths?.length ? "Assigned lessons and sequences" : "No curriculum assigned yet"}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setShowProgramModal(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5" title="Link Full Programs">
                      <Layers className="h-3.5 w-3.5" /> Programs
                    </button>
                    <button onClick={() => setShowPathModal(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 shadow-sm" title="Manage Custom Paths">
                      Manage Custom Paths
                    </button>
                  </div>
                )}
              </div>

              {isCurriculumExpanded && (
                <div className="px-6 pb-6 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {((cohort.programs?.length ?? 0) > 0 || (cohort.learningPaths?.length ?? 0) > 0) && isEnrolled && !canManage && (
                    <div className="mb-6">
                      {(() => {
                        const totalLessons = cohort.programs.reduce((sum, p) => sum + p.modules.reduce((mSum, m) => mSum + m.lessons.length, 0), 0);
                        const totalAssessments = cohort.programs.reduce((sum, p) => sum + p.modules.reduce((mSum, m) => mSum + m.assessments.length, 0), 0);
                        const totalItems = totalLessons + totalAssessments;
                        const completedItems = (cohort.completedLessonIds?.length || 0) + (cohort.completedAssessmentIds?.length || 0);
                        const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : (completedItems > 0 ? 100 : 0);

                        return (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Your Progress</label>
                              <span className="text-sm font-bold text-slate-600 dark:text-slate-400">{completedItems}/{totalItems || completedItems}</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                              <div className={`h-2.5 rounded-full transition-all duration-1000 ${progressPct >= 100 ? "bg-emerald-500" : progressPct >= 50 ? "bg-primary" : "bg-amber-500"}`} style={{ width: `${Math.min(progressPct, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {(!cohort.programs?.length && !cohort.learningPaths?.length) ? (
                    <div className="text-center py-10 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20">
                      <p className="text-sm text-slate-400">No educational content assigned yet.</p>
                      {canManage && (
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-5">
                          <button onClick={() => setShowProgramModal(true)} className="px-5 py-2 rounded-lg bg-primary text-white text-xs font-bold uppercase tracking-widest hover:bg-primary-dark transition-all shadow-md">Link Programs</button>
                          <span className="text-xs font-bold text-slate-400 uppercase">OR</span>
                          <button onClick={() => setShowPathModal(true)} className="px-5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 transition-all">Create Custom Path</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-10">
                      
                      {cohort.learningPaths && cohort.learningPaths.length > 0 && (
                        <div className="space-y-6">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-primary/30 pb-2 flex items-center gap-2">
                            <Route className="h-4 w-4 text-primary" /> Learning Paths
                          </h3>
                          {cohort.learningPaths.map((path) => {
                            const isExpanded = expandedPaths.has(path.id);
                            return (
                              <div key={path.id} className="mb-1">
                                <div 
                                  className="group flex flex-col sm:flex-row sm:items-center justify-between py-3 cursor-pointer border-b border-transparent hover:border-slate-200 dark:hover:border-slate-700/50 transition-colors" 
                                  onClick={() => togglePathExpanded(path.id)}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="text-slate-400 group-hover:text-primary transition-colors">
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </div>
                                    <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200 group-hover:text-primary transition-colors">
                                      {path.title}
                                    </h3>
                                  </div>
                                </div>
                                
                                {isExpanded && (
                                  <div className="mt-2 mb-6 ml-2 pl-5 border-l-2 border-slate-100 dark:border-slate-800 space-y-1 animate-fade-in relative">
                                    {path.items.map((item, idx) => {
                                      const lesson = item.lesson;
                                      if (!lesson) return null;
                                      const isCompleted = cohort.completedLessonIds?.includes(lesson.id);
                                      return (
                                        <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all group relative">
                                          {isEnrolled ? (
                                            <Link href={`/courses/${lesson.module?.programId || 'unknown'}/${lesson.id}?cohortId=${cohort.id}&pathId=${path.id}`} className="flex items-center gap-3 flex-1 cursor-pointer">
                                              <div className={`w-7 h-7 flex-shrink-0 rounded-md flex items-center justify-center ${lesson.type === "video" ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500" : "bg-slate-50 dark:bg-slate-800 text-slate-400"}`}>
                                                {isCompleted ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : lesson.type === "video" ? <Video className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                              </div>
                                              <div>
                                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-primary transition-colors">
                                                  <span className="text-slate-400 font-normal mr-2">{idx + 1}.</span>{lesson.name}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                                  <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
                                                  {formatDuration(lesson.duration)} • {lesson.type}
                                                </p>
                                              </div>
                                            </Link>
                                          ) : (
                                            <div className="flex items-center gap-3">
                                              <div className="w-7 h-7 rounded-md flex items-center justify-center bg-slate-50 dark:bg-slate-800 text-slate-400"><FileText className="h-3.5 w-3.5" /></div>
                                              <div>
                                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                                  <span className="text-slate-400 mr-2">{idx + 1}.</span>{lesson.name}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                                  <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
                                                  {formatDuration(lesson.duration)} • {lesson.type}
                                                </p>
                                              </div>
                                            </div>
                                          )}
                                          {isEnrolled && <Link href={`/courses/${lesson.module?.programId || 'unknown'}/${lesson.id}?cohortId=${cohort.id}&pathId=${path.id}`} className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-widest text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-primary transition-all ml-4 flex-shrink-0">VIEW</Link>}
                                          {!isEnrolled && <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest border border-slate-100 dark:border-slate-800 px-1.5 py-0.5 rounded">Locked</div>}
                                        </div>
                                      );
                                    })}
                                    {(!path.items || path.items.length === 0) && <div className="p-3 text-xs text-slate-400 italic">No lessons assigned to this path.</div>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* === RENDER BASE PROGRAMS === */}
                      {cohort.programs && cohort.programs.length > 0 && (
                        <div className="space-y-6">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-primary/30 pb-2 flex items-center gap-2">
                            <Layers className="h-4 w-4 text-primary" /> Available Courses
                          </h3>
                          {cohort.programs.map((program) => {
                            const isExpanded = expandedPrograms.has(program.id);
                            const totalLessons = program.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                            const totalDuration = program.modules.reduce((sum, mod) => sum + mod.lessons.reduce((lSum, l) => lSum + (l.duration || 0), 0), 0);
                            
                            return (
                              <div key={program.id} className="mb-1">
                                <div 
                                  className="group flex flex-col sm:flex-row sm:items-center justify-between py-3 cursor-pointer border-b border-transparent hover:border-slate-200 dark:hover:border-slate-700/50 transition-colors" 
                                  onClick={() => toggleProgramExpanded(program.id)}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="text-slate-400 group-hover:text-primary transition-colors">
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </div>
                                    <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200 group-hover:text-primary transition-colors">
                                      {program.name.startsWith("Recordings (") ? "Recordings" : program.name}
                                    </h3>
                                  </div>
                                  <div className="flex items-center mt-2 sm:mt-0 ml-7 sm:ml-0 text-xs font-medium text-slate-500 dark:text-slate-400">
                                    <div className="w-[90px] flex items-center gap-1.5">
                                      <FileText className="h-3.5 w-3.5 opacity-70 flex-shrink-0" /> 
                                      <span className="truncate">{totalLessons} lessons</span>
                                    </div>
                                    <div className="w-8 flex justify-center opacity-30">•</div>
                                    <div className="w-[70px] flex items-center gap-1.5">
                                      <Clock className="h-3.5 w-3.5 opacity-70 flex-shrink-0" /> 
                                      <span className="truncate">{formatDuration(totalDuration)}</span>
                                    </div>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="mt-2 mb-6 ml-2 pl-5 border-l-2 border-slate-100 dark:border-slate-800 space-y-6 animate-fade-in relative">
                                    {program.modules.map((mod) => (
                                      <div key={mod.id} className="space-y-2">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{mod.name}</h4>
                                        <div className="space-y-1">
                                          {mod.lessons.map((lesson) => {
                                            const isCompleted = cohort.completedLessonIds?.includes(lesson.id);
                                            return (
                                              <div key={lesson.id} className="flex items-center justify-between p-2.5 rounded-lg border border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all group">
                                                {isEnrolled ? (
                                                  <Link href={`/courses/${program.id}/${lesson.id}?cohortId=${cohort.id}`} className="flex items-center gap-3 flex-1 cursor-pointer">
                                                    <div className={`w-7 h-7 rounded-md flex items-center justify-center ${lesson.type === "video" ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500" : "bg-slate-50 dark:bg-slate-800 text-slate-400"}`}>
                                                      {isCompleted ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : lesson.type === "video" ? <Video className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                                    </div>
                                                    <div>
                                                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-primary transition-colors">{lesson.name}</p>
                                                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                                        <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
                                                        {formatDuration(lesson.duration)} • {lesson.type}
                                                      </p>
                                                    </div>
                                                  </Link>
                                                ) : (
                                                  <div className="flex items-center gap-3">
                                                    <div className={`w-7 h-7 rounded-md flex items-center justify-center ${lesson.type === "video" ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500" : "bg-slate-50 dark:bg-slate-800 text-slate-400"}`}>
                                                      {isCompleted ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : lesson.type === "video" ? <Video className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                                    </div>
                                                    <div>
                                                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{lesson.name}</p>
                                                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                                                        <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
                                                        {formatDuration(lesson.duration)} • {lesson.type}
                                                      </p>
                                                    </div>
                                                  </div>
                                                )}
                                                {isEnrolled && <Link href={`/courses/${program.id}/${lesson.id}?cohortId=${cohort.id}`} className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-widest text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-primary transition-all ml-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>VIEW</Link>}
                                                {!isEnrolled && <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest border border-slate-100 dark:border-slate-800 px-1.5 py-0.5 rounded flex-shrink-0">Locked</div>}
                                              </div>
                                            );
                                          })}
                                          {mod.assessments.map((ass: any) => {
                                            const isCompleted = cohort.completedAssessmentIds?.includes(ass.id);
                                            return (
                                              <div key={ass.id} className="flex items-center justify-between p-2.5 rounded-lg border border-transparent hover:bg-amber-50/30 dark:hover:bg-amber-900/10 transition-all group">
                                                {isEnrolled ? (
                                                  <Link href={`/courses/${program.id}/${ass.id}?cohortId=${cohort.id}`} className="flex items-center gap-3 flex-1 cursor-pointer">
                                                    <div className={`w-7 h-7 rounded-md flex items-center justify-center ${isCompleted ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500" : "bg-amber-50 dark:bg-amber-900/20 text-amber-500"}`}>
                                                      {isCompleted ? <CheckCircle className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                                    </div>
                                                    <div>
                                                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-amber-600 transition-colors">{ass.name}</p>
                                                      <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider mt-0.5">Assessment</p>
                                                    </div>
                                                  </Link>
                                                ) : (
                                                  <div className="flex items-center gap-3">
                                                    <div className="w-7 h-7 rounded-md flex items-center justify-center bg-amber-50 text-amber-500"><FileText className="h-3.5 w-3.5" /></div>
                                                    <div>
                                                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{ass.name}</p>
                                                      <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider mt-0.5">Assessment</p>
                                                    </div>
                                                  </div>
                                                )}
                                                {isEnrolled && <Link href={`/courses/${program.id}/${ass.id}?cohortId=${cohort.id}`} className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-widest text-amber-500 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-amber-500 transition-all ml-4 flex-shrink-0" onClick={(e) => e.stopPropagation()}>TAKE</Link>}
                                                {!isEnrolled && <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest border border-slate-100 dark:border-slate-800 px-1.5 py-0.5 rounded">Locked</div>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in stagger-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-4">Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {cohort.startDate && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Dates</p>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {new Date(cohort.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                        {cohort.endDate && ` — ${new Date(cohort.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`}
                      </p>
                    </div>
                  </div>
                )}

                {cohort.location && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Location</p>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{cohort.location}</p>
                    </div>
                  </div>
                )}

                {joinLink && isEnrolled && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center shrink-0">
                      <Video className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Zoom Link</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <a href={joinLink} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-primary hover:text-primary-dark hover:underline">Launch Meeting</a>
                        {nextSessionText && (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border shadow-sm transition-all ${nextSessionText.isLive ? 'bg-rose-500 text-white border-rose-600 shadow-rose-500/30 animate-pulse' : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-700/50'}`}>
                            <Clock className="h-3.5 w-3.5" /> {nextSessionText.isLive ? "Live now" : `Starts ${nextSessionText.text}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                    <DeliveryIcon className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Delivery Mode</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{DELIVERY_LABELS[cohort.deliveryMode] || cohort.deliveryMode}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Sessions */}
            {cohort.sessions.length > 0 && (() => {
              const processedSessions = cohort.sessions.map((s) => ({ ...s, actualStatus: getDynamicStatus(s.startTime, s.endTime, s.status) }));
              const completedSessions = processedSessions.filter((s) => s.actualStatus === "completed");
              const activeSessions = processedSessions.filter((s) => s.actualStatus !== "completed");

              const renderSession = (s: any, isPast: boolean) => {
                const d = new Date(s.date);
                return (
                  <div key={s.id} className={`flex px-6 py-5 transition-colors ${s.actualStatus === "live" ? "border-l-4 border-l-primary bg-primary/5" : isPast ? "bg-slate-50/50 dark:bg-slate-800/20" : ""}`}>
                    <div className="w-16 flex-shrink-0 text-center">
                      <span className="text-xs font-bold uppercase tracking-wider block text-slate-500 dark:text-slate-400">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                      <span className="text-xl font-bold block mt-1 text-slate-900 dark:text-white">{d.getDate()}</span>
                    </div>
                    <div className="ml-6 flex-1">
                      <h3 className={`text-base font-semibold ${isPast ? "text-slate-900 dark:text-white line-through opacity-60" : "text-slate-900 dark:text-white"}`}>{s.title}</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatLocalTime(s.startTime)} - {formatLocalTime(s.endTime)} {s.startTime?.includes("T") ? ` (${Intl.DateTimeFormat().resolvedOptions().timeZone})` : ` ${s.timezone}`}
                      </p>
                      {s.description && <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 line-clamp-2">{s.description}</p>}
                      {isPast && s.recordingLink && (
                        <div className="mt-3">
                          <a href={s.recordingLink} className="text-sm text-primary hover:underline font-medium flex items-center gap-1" target="_blank" rel="noopener noreferrer"><Video className="h-3.5 w-3.5" /> View Recording</a>
                        </div>
                      )}
                    </div>
                    {isPast && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 self-start">Completed</span>}
                    {s.actualStatus === "live" && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-primary text-white uppercase tracking-wider animate-pulse self-start">Live</span>}
                  </div>
                );
              };

              return (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in stagger-3">
                  <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-primary" /> Sessions <span className="text-sm font-normal text-slate-400">({activeSessions.length} upcoming{completedSessions.length > 0 ? `, ${completedSessions.length} past` : ""})</span>
                    </h2>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {completedSessions.length > 0 && (
                      <div className="bg-slate-50/30 dark:bg-slate-800/10">
                        <div className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors" onClick={() => setShowCompletedSessions(!showCompletedSessions)}>
                          <div className="flex items-center gap-3"><CheckCircle className="h-4 w-4 text-slate-400" /><span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Past Sessions ({completedSessions.length})</span></div>
                          {showCompletedSessions ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                        </div>
                        {showCompletedSessions && <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">{completedSessions.map(s => renderSession(s, true))}</div>}
                      </div>
                    )}
                    {activeSessions.length > 0 ? (
                      <div className="bg-slate-50/30 dark:bg-slate-800/10">
                        <div className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors" onClick={() => setShowUpcomingSessions(!showUpcomingSessions)}>
                          <div className="flex items-center gap-3"><Clock className="h-4 w-4 text-primary" /><span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Upcoming Sessions ({activeSessions.length})</span></div>
                          {showUpcomingSessions ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                        </div>
                        {showUpcomingSessions && <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">{activeSessions.map(s => renderSession(s, false))}</div>}
                      </div>
                    ) : (
                      completedSessions.length > 0 && <div className="px-6 py-8 text-center text-slate-500 text-sm">No upcoming sessions scheduled.</div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Right sidebar */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in stagger-1">
              <div className="flex justify-between items-center mb-4"><h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Cohort Capacity</h2><UsersIcon className="h-5 w-5 text-slate-400" /></div>
              <div className="flex items-end justify-between mb-2">
                <div className="text-3xl font-bold text-slate-900 dark:text-white">{cohort.totalMembers}<span className="text-lg font-medium text-slate-500 dark:text-slate-400">/{cohort.seats}</span></div>
                <div className={`text-sm font-medium px-2.5 py-1 rounded-lg ${seatsLeft <= 0 ? "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20" : seatsLeft <= 5 ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20" : "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"}`}>
                  {seatsLeft <= 0 ? "Full" : `${seatsLeft} seats left`}
                </div>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mb-4 overflow-hidden">
                <div className={`h-2.5 rounded-full transition-all duration-1000 ${fillPct >= 100 ? "bg-rose-500" : fillPct >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(fillPct, 100)}%` }} />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in stagger-2">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider">Instructors</h2>
                {canManage && <button onClick={() => setShowInstructorModal(true)} className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors" title="Add Instructor"><UserPlus className="h-4 w-4" /></button>}
              </div>
              <div className="space-y-3">
                {cohort.instructors.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 italic">No instructors assigned yet.</p>
                ) : (
                  cohort.instructors.map((inst) => <InstructorCard key={inst.id} id={inst.id} name={inst.name} email={inst.email} image={inst.image} bio={inst.bio} role={inst.role} canManage={canManage} onRemove={() => handleRemoveInstructor(inst.id)} />)
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in stagger-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-4">Quick Info</h2>
              <div className="space-y-3.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Status</span><span className="font-medium text-slate-900 dark:text-white">{STATUS_LABELS[cohort.status] || cohort.status}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Delivery</span><span className="font-medium text-slate-900 dark:text-white">{DELIVERY_LABELS[cohort.deliveryMode] || cohort.deliveryMode}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Sessions</span><span className="font-medium text-slate-900 dark:text-white">{cohort.sessions.length}</span></div>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Groups</span><span className="font-medium text-slate-900 dark:text-white">{cohort.groups.length}</span></div>
                {joinLink && isEnrolled && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-700/50">
                    <div className="flex flex-col items-center gap-2">
                      <a href={joinLink} target="_blank" rel="noopener noreferrer" className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm flex justify-center items-center gap-2">
                        <Video className="h-4 w-4" /> Join Zoom
                      </a>
                      {nextSessionText && <span className={`text-xs font-medium ${nextSessionText.isLive ? 'text-rose-500 animate-pulse' : 'text-slate-500 dark:text-slate-400'}`}>{nextSessionText.isLive ? "● Live now" : `Next session ${nextSessionText.text}`}</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Certificates Panel */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-6 animate-fade-in stagger-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                <Award className="h-4 w-4 text-purple-500" />
                Certificates
              </h2>
              {canManage ? (
                <div className="space-y-3">
                  <button
                    onClick={() => setShowCertificateModal(true)}
                    className="w-full px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-purple-500/30 transition-all"
                  >
                    Generate Batch
                  </button>
                  <button
                    onClick={() => setShowCertificatesListModal(true)}
                    className="w-full px-4 py-2 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    View Issued ({issuedCertificates.length})
                  </button>
                  <button
                    onClick={() => cohortNotifier.startNotification("certificates-panel")}
                    disabled={cohortNotifier.isInFlight || issuedCertificates.length === 0}
                    className="w-full px-4 py-2 border-2 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50"
                  >
                    {cohortNotifier.isInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Notify students
                  </button>
                  {cohortNotifier.entryError?.source === "certificates-panel" && (
                    <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-xs">
                      {cohortNotifier.entryError.message}
                    </div>
                  )}
                </div>
              ) : (
                issuedCertificates.length > 0 ? (
                  <div className="space-y-4">
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg border border-emerald-100 dark:border-emerald-800 text-center font-medium">
                      Congratulations! Your certificate is ready.
                    </p>
                    <div className="flex gap-2">
                      <button 
                        onClick={(e) => handleForceDownload(e, issuedCertificates[0].pdfUrl, `Certificate-${cohort.title}.pdf`)} 
                        className="flex-1 px-3 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold text-center hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-sm"
                      >
                        Download PDF
                      </button>
                      <button 
                        onClick={() => setPreviewImage(issuedCertificates[0].pngUrl)} 
                        className="flex-1 px-3 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold text-center hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        View Image
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-2">
                    Not issued yet.
                  </p>
                )
              )}
            </div>
          </div>
        </div>
        {isEnrolled && cohort && (
          <div id="cohort-chat" className="max-w-6xl mx-auto mt-8">
            <CohortChatPanel cohort={cohort} onExpand={() => setShowChatModal(true)} />
          </div>
        )}
      </div>

      {showGroupModal && <GroupModal cohortId={cohort.id} group={editingGroup} onClose={() => { setShowGroupModal(false); setEditingGroup(null); }} onSaved={fetchCohort} />}
      {addMemberGroupId && cohort && <AddMemberModal cohortId={cohort.id} groupId={addMemberGroupId} existingMemberIds={cohort.groups.find((g) => g.id === addMemberGroupId)?.members.map((m) => m.userId) || []} onClose={() => setAddMemberGroupId(null)} onAdded={fetchCohort} />}
      {showInstructorModal && <InstructorModal query={instructorQuery} onQueryChange={setInstructorQuery} users={instructors} searching={searchingInstructors} adding={addingInstructor} onClose={() => setShowInstructorModal(false)} onAdd={handleAddInstructor} existingInstructorIds={cohort.instructors.map(i => i.id)} />}
      {showProgramModal && cohort && <ProgramSelectorModal currentProgramIds={cohort.programs ? cohort.programs.map((p) => p.id) : []} onClose={() => setShowProgramModal(false)} onSelect={handleUpdateProgram} />}
      
      {showJoinModal && cohort && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col animate-fade-in">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
              <div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Join Cohort</h2><p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Select a group to join</p></div>
              <button onClick={() => setShowJoinModal(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><X className="h-5 w-5 text-slate-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cohort.groups.length === 0 ? (
                <div className="text-center py-8"><Layers className="h-10 w-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" /><p className="text-sm text-slate-500 dark:text-slate-400">No groups available yet.</p></div>
              ) : (
                cohort.groups.map((group) => {
                  const memberCount = group._count?.members || group.members?.length || 0;
                  const seatsLeft = group.seats - memberCount;
                  const isFull = seatsLeft <= 0;
                  return (
                    <div key={group.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary/30 transition-colors">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{group.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1"><UsersIcon className="h-3 w-3" />{isFull ? "Full" : `${seatsLeft} seats left`}</span>
                          <span className={`text-xs font-semibold ${group.price > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{group.price > 0 ? `$${group.price.toFixed(2)}` : "Free"}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${group.inPerson ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"}`}>{group.inPerson ? "In Person" : "Online"}</span>
                        </div>
                      </div>
                      {isFull ? (
                        <span className="text-xs text-slate-400 font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">Full</span>
                      ) : group.price > 0 ? (
                        <Link href={`/cohorts/${cohort.id}/pay/${group.id}`} onClick={() => setShowJoinModal(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-1.5 shadow-sm"><DollarSign className="h-3 w-3" /> Pay & Join</Link>
                      ) : (
                        <button onClick={() => handleJoinGroup(group.id, group.price)} disabled={joining === group.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary hover:bg-primary-dark transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm">
                          {joining === group.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Join Free
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {showLeaveConfirm && leavingGroupId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-sm animate-fade-in">
            <div className="p-6"><h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Leave Group?</h2><p className="text-sm text-slate-600 dark:text-slate-400 mb-6">Are you sure you want to leave this group? If you have no other groups in this cohort, you will be removed from the cohort as well.</p></div>
            <div className="border-t border-slate-200 dark:border-slate-700 p-6 flex items-center justify-end gap-3">
              <button onClick={() => { setShowLeaveConfirm(false); setLeavingGroupId(null); }} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-medium">Cancel</button>
              <button onClick={() => handleLeaveGroup(leavingGroupId)} disabled={leavingGroupId === "loading"} className="px-4 py-2 rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                {leavingGroupId && leavingGroupId !== "loading" ? <><UserMinus className="h-4 w-4" />Leave Group</> : <><Loader2 className="h-4 w-4 animate-spin" />Leaving...</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInstructorSlotsModal && selectedGroupForSlots && <InstructorSlotsModal cohortId={cohort?.id || ""} groupId={selectedGroupForSlots} onClose={() => { setShowInstructorSlotsModal(false); setSelectedGroupForSlots(null); fetchCohort(); }} />}
      {showStudentBookingModal && selectedGroupForBooking && <StudentBookingModal cohortId={cohort?.id || ""} groupId={selectedGroupForBooking} onClose={() => { setShowStudentBookingModal(false); setSelectedGroupForBooking(null); }} onBooked={() => { fetchCohort(); fetchMyApprovedSessions(); }} />}
      {showBookingManagementModal && selectedGroupForRequests && <BookingManagementModal cohortId={cohort?.id || ""} groupId={selectedGroupForRequests} onClose={() => { setShowBookingManagementModal(false); setSelectedGroupForRequests(null); }} onUpdated={() => { fetchCohort(); fetchMyApprovedSessions(); }} />}
      {showPathModal && cohort && <LearningPathModal cohortId={cohort.id} onClose={() => setShowPathModal(false)} onSaved={fetchCohort} />}
      {showMaterialModal && cohort && <MaterialModal cohortId={cohort.id} cohortTitle={cohort.title} onClose={() => setShowMaterialModal(false)} onSaved={fetchCohort} />}
      {showAllMaterialsModal && cohort && <ViewMaterialsModal materials={cohort.materials ?? []} onClose={() => setShowAllMaterialsModal(false)} />}
      {showCertificateModal && cohort && <GenerateCertificatesModal cohort={cohort} onClose={() => setShowCertificateModal(false)} onFinished={() => { fetchCohort(); fetchCertificates();}} />}
            {showCertificatesListModal && (
        <CertificatesListModal 
          certificates={issuedCertificates} 
          onClose={() => setShowCertificatesListModal(false)}
          onPreview={(url) => setPreviewImage(url)}
          onDelete={handleDeleteCertificate}
        />
      )}

      <CertificateNotifyDialog
        dialog={cohortNotifier.dialog}
        dialogError={cohortNotifier.dialogError}
        isInFlight={cohortNotifier.isInFlight}
        onConfirm={cohortNotifier.confirmNotification}
        onClose={cohortNotifier.closeDialog}
      />

      {/* Chat modal */}
      {showChatModal && cohort && <CohortChatModal cohort={cohort} onClose={() => setShowChatModal(false)} />}

      {/* PNG preview modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in" 
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="absolute -top-12 right-0 flex justify-end">
              <button onClick={() => setPreviewImage(null)} className="p-2 text-white/70 hover:text-white transition-colors bg-black/50 hover:bg-black/80 rounded-full backdrop-blur-md">
                <X className="h-6 w-6" />
              </button>
            </div>
            <img 
              src={previewImage} 
              alt="Certificate Preview" 
              className="w-auto h-auto max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" 
            />
          </div>
        </div>
      )}
    </>
  );
}
