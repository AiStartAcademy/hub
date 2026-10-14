"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail, Phone, ArrowLeft, BellOff, Loader2, X, Plus,
  Send, Download, MonitorPlay, FileText, StickyNote, MousePointerClick,
  Eye, AlertCircle, LogOut, CheckCircle2, UserPlus, Sparkles,
  ShoppingCart, CreditCard, Undo2, PhoneCall, PhoneOff, PhoneMissed, Bot,
  MessageSquare, MessageCircle,
  CalendarClock,
  Cake,
} from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "../leadStatus";
import { callOutcomeLabel } from "../callOutcomes";
import {
  updateLeadPipelineExclusion,
  updateLeadStatus,
  updateLeadNotes,
} from "../actions";
import {
  getTimelinePage,
  linkContactToUserAction,
  regenerateLeadBrief,
  searchUsersByEmail,
  setDoNotCall,
  startAiCall,
  unlinkContactAction,
  updateContactBirthday,
  updateLeadTags,
} from "./actions";
import type { SmsMessageDTO } from "./actions";
import type { LeadBrief } from "@/lib/leads/brief";
import type { TimelineItem, TimelinePage, TimelineKind } from "@/lib/leads/timeline";
import { previewSafeHtml } from "@/lib/outreach/previewSafeHtml";
import { normalizePhoneE164 } from "@/lib/phone";
import { useSoftphone } from "@/components/softphone/SoftphoneProvider";
import OutreachComposer from "./OutreachComposer";

export type AnsweredQuestion = { question: string; answers: string[] };

export type LeadBookingSummary = {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  timezone: string;
  closerName: string;
  zoomJoinUrl: string | null;
};

export type LeadProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  birthday: string | null;
  status: string;
  excludeFromPipeline: boolean;
  source: string | null;
  attribution: Record<string, string>;
  tags: string[];
  notes: string | null;
  createdAt: string;
  lastActivityAt: string | null;
  unsubscribedAt: string | null;
  phoneConsentAt: string | null;
  smsMarketingConsentAt: string | null;
  smsTransactionalConsentAt: string | null;
  smsOptOutAt: string | null;
  doNotCall: boolean;
  enrollments: Array<{
    id: string;
    campaignId: string;
    campaignName: string;
    status: string;
    lastStepOrder: number;
    stepCount: number;
    nextRunAt: string | null;
    exitReason: string | null;
    enrolledAt: string;
  }>;
  journal: Array<{
    id: string;
    body: string;
    authorLabel: string;
    kind: string;
    createdAt: string;
  }>;
  responses: Array<{
    id: string;
    formTitle: string;
    formSlug: string;
    submittedAt: string;
    answers: AnsweredQuestion[];
  }>;
  engagement: { sent: number; opened: number; clicked: number; failed: number };
  aiBrief: LeadBrief | null;
};

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

const TIMELINE_ICON: Record<TimelineKind, typeof Mail> = {
  email_sent: Send,
  email_failed: AlertCircle,
  email_opened: Eye,
  email_clicked: MousePointerClick,
  email_unsubscribed: BellOff,
  asset_download: Download,
  lesson_view: MonitorPlay,
  onboarding: FileText,
  manual: StickyNote,
  drip_enrolled: UserPlus,
  drip_completed: CheckCircle2,
  drip_exited: LogOut,
  checkout_started: ShoppingCart,
  checkout_abandoned: ShoppingCart,
  purchase: CreditCard,
  refund: Undo2,
  note: StickyNote,
  call_initiated: PhoneCall,
  call_completed: Bot,
  call_no_answer: PhoneMissed,
  call_failed: PhoneOff,
  call_logged: Phone,
  sms_outbound: MessageSquare,
  sms_inbound: MessageCircle,
  booking_created: CalendarClock,
  booking_cancelled: CalendarClock,
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtBookingWindow(booking: LeadBookingSummary): string {
  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: booking.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: booking.timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${date} · ${time.format(start)}–${time.format(end)}`;
}

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] uppercase tracking-widest font-black text-slate-400">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function LeadProfileClient({
  lead,
  initialTimeline,
  smsThread,
  bookings,
  trackRecord,
  linkedUser,
}: {
  lead: LeadProfile;
  initialTimeline: TimelinePage;
  smsThread: SmsMessageDTO[];
  bookings: LeadBookingSummary[];
  /** Rendered server-side and passed in, so this client bundle stays lean. */
  trackRecord: React.ReactNode;
  linkedUser: { id: string; email: string; name: string | null } | null;
}) {
  const router = useRouter();
  const { status: softphoneStatus, startCall: startBrowserCall } = useSoftphone();
  const [tab, setTab] = useState<"crm" | "track">("crm");
  const [status, setStatus] = useState(lead.status);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [excludedFromPipeline, setExcludedFromPipeline] = useState(
    lead.excludeFromPipeline
  );
  const [exclusionSaving, setExclusionSaving] = useState(false);
  const [exclusionError, setExclusionError] = useState<string | null>(null);
  const [tags, setTags] = useState(lead.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [generalNotes, setGeneralNotes] = useState(lead.notes ?? "");
  const [items, setItems] = useState<TimelineItem[]>(initialTimeline.items);
  const [cursor, setCursor] = useState<string | null>(initialTimeline.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [timelineRefreshing, setTimelineRefreshing] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [brief, setBrief] = useState<LeadBrief | null>(lead.aiBrief);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [dnc, setDnc] = useState(lead.doNotCall);
  const [callState, setCallState] = useState<"idle" | "calling" | "placed">("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [browserCallStarting, setBrowserCallStarting] = useState(false);
  const [browserCallError, setBrowserCallError] = useState<string | null>(null);
  const [birthday, setBirthday] = useState(lead.birthday ?? "");
  const [birthdaySaving, setBirthdaySaving] = useState(false);
  const [birthdayError, setBirthdayError] = useState<string | null>(null);
  const [account, setAccount] = useState(linkedUser);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<
    Array<{ id: string; email: string; name: string | null }>
  >([]);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mountedRef = useRef(true);
  const statusRequestIdRef = useRef(0);
  const statusInFlightRef = useRef(false);
  const timelineRequestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      statusRequestIdRef.current += 1;
      timelineRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!statusInFlightRef.current) setStatus(lead.status);
  }, [lead.status]);

  // Sync server props into local state during render (React's "adjusting state
  // when a prop changes" pattern) — skipped while a save is in flight so the
  // optimistic value is not clobbered by a stale router.refresh payload.
  const [prevServerBirthday, setPrevServerBirthday] = useState(lead.birthday ?? "");
  if ((lead.birthday ?? "") !== prevServerBirthday) {
    setPrevServerBirthday(lead.birthday ?? "");
    if (!birthdaySaving) setBirthday(lead.birthday ?? "");
  }

  const [prevServerExclusion, setPrevServerExclusion] = useState(
    lead.excludeFromPipeline
  );
  if (lead.excludeFromPipeline !== prevServerExclusion) {
    setPrevServerExclusion(lead.excludeFromPipeline);
    if (!exclusionSaving) setExcludedFromPipeline(lead.excludeFromPipeline);
  }

  const [prevServerAccount, setPrevServerAccount] = useState(linkedUser);
  if (linkedUser !== prevServerAccount) {
    setPrevServerAccount(linkedUser);
    if (!accountSaving) setAccount(linkedUser);
  }

  function changeBirthday(next: string): void {
    if (birthdaySaving || next === birthday) return;
    const previous = birthday;
    setBirthday(next);
    setBirthdaySaving(true);
    setBirthdayError(null);
    // Server actions follow the enclosing Next request lifecycle; no separate
    // client timer can safely determine whether the database write committed.
    updateContactBirthday(lead.id, next)
      .then((saved) => {
        if (!mountedRef.current) return;
        setBirthday(saved ?? "");
        router.refresh();
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        setBirthday(previous);
        setBirthdayError(
          error instanceof Error ? error.message : "Could not update birthday"
        );
      })
      .finally(() => {
        if (mountedRef.current) setBirthdaySaving(false);
      });
  }

  async function changePipelineExclusion(next: boolean): Promise<void> {
    if (exclusionSaving || next === excludedFromPipeline) return;
    const previous = excludedFromPipeline;
    setExcludedFromPipeline(next);
    setExclusionSaving(true);
    setExclusionError(null);
    try {
      await updateLeadPipelineExclusion(lead.id, next);
      router.refresh();
    } catch (error: unknown) {
      setExcludedFromPipeline(previous);
      setExclusionError(
        error instanceof Error ? error.message : "Could not update pipeline visibility"
      );
    } finally {
      setExclusionSaving(false);
    }
  }

  async function searchUsers(): Promise<void> {
    setAccountError(null);
    setUserResults([]);
    if (userQuery.trim().length < 3) {
      setAccountError("Enter at least 3 characters of an email address.");
      return;
    }
    setAccountSaving(true);
    try {
      setUserResults(await searchUsersByEmail(userQuery));
    } catch (error: unknown) {
      setAccountError(error instanceof Error ? error.message : "Could not search users");
    } finally {
      setAccountSaving(false);
    }
  }

  async function linkUser(user: { id: string; email: string; name: string | null }): Promise<void> {
    setAccountSaving(true);
    setAccountError(null);
    try {
      const linked = await linkContactToUserAction(lead.id, user.id);
      setAccount(linked);
      setUserQuery("");
      setUserResults([]);
      router.refresh();
    } catch (error: unknown) {
      setAccountError(error instanceof Error ? error.message : "Could not link account");
    } finally {
      setAccountSaving(false);
    }
  }

  async function unlinkUser(): Promise<void> {
    setAccountSaving(true);
    setAccountError(null);
    try {
      await unlinkContactAction(lead.id);
      setAccount(null);
      router.refresh();
    } catch (error: unknown) {
      setAccountError(error instanceof Error ? error.message : "Could not unlink account");
    } finally {
      setAccountSaving(false);
    }
  }

  async function refreshTimelinePageOne(actionLabel: string): Promise<void> {
    const requestId = ++timelineRequestIdRef.current;
    setTimelineRefreshing(true);
    setTimelineError(null);
    try {
      const page = await getTimelinePage(lead.id, null);
      if (!mountedRef.current || requestId !== timelineRequestIdRef.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (error: unknown) {
      if (!mountedRef.current || requestId !== timelineRequestIdRef.current) return;
      console.error("Timeline page-one refresh failed after CRM action", {
        contactId: lead.id,
        actionLabel,
        error,
      });
      setTimelineError(`${actionLabel} saved, but Activity could not refresh. Refresh the page to retry.`);
    } finally {
      if (mountedRef.current && requestId === timelineRequestIdRef.current) {
        setTimelineRefreshing(false);
      }
    }
  }

  const callBlockedReason = dnc
    ? "Flagged do-not-call"
    : !lead.phoneConsentAt
      ? "No call consent on record"
      : !lead.phone
        ? "No phone number"
        : null;

  const browserPhoneValid = normalizePhoneE164(lead.phone) !== null;
  const browserCallActive = softphoneStatus === "incoming" || softphoneStatus === "in-call";
  const browserCallDisabledReason = !lead.phone
    ? "Browser call disabled: no phone number"
    : !browserPhoneValid
      ? "Browser call disabled: phone number is invalid"
      : softphoneStatus === "incoming"
        ? "Browser call disabled while another call is incoming"
        : softphoneStatus === "in-call"
          ? "A browser call is already active"
          : browserCallStarting
            ? "Browser call is connecting"
            : null;

  async function callWithAi() {
    setCallError(null);
    setCallState("calling");
    try {
      const result = await startAiCall(lead.id);
      if (result.ok) {
        setCallState("placed");
      } else {
        setCallState("idle");
        setCallError(result.reason);
      }
    } catch (e) {
      setCallState("idle");
      setCallError(e instanceof Error ? e.message : "Call failed");
    }
  }

  async function callWithBrowser() {
    if (!lead.phone) {
      setBrowserCallError("Browser call failed: this lead has no phone number.");
      return;
    }
    if (!normalizePhoneE164(lead.phone)) {
      setBrowserCallError("Browser call failed: this lead's phone number is invalid.");
      return;
    }
    if (browserCallActive || browserCallStarting) {
      setBrowserCallError("Browser call failed: another call is already active or connecting.");
      return;
    }

    setBrowserCallError(null);
    setBrowserCallStarting(true);
    try {
      await startBrowserCall(lead.id, lead.phone);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setBrowserCallError(`Browser call failed: ${message}`);
    } finally {
      setBrowserCallStarting(false);
    }
  }

  function toggleDnc() {
    const next = !dnc;
    setDnc(next);
    startTransition(() => {
      setDoNotCall(lead.id, next).catch((error: unknown) => {
        if (mountedRef.current) setDnc(!next);
        console.error("Failed to update do-not-call setting", { contactId: lead.id, error });
      });
    });
  }

  async function makeBrief() {
    setBriefLoading(true);
    setBriefError(null);
    try {
      setBrief(await regenerateLeadBrief(lead.id));
    } catch (e) {
      // Surfaced, not swallowed: "the model is unreachable" must not be
      // indistinguishable from "there's nothing to say about this lead".
      setBriefError(e instanceof Error ? e.message : "Could not generate a brief");
    } finally {
      setBriefLoading(false);
    }
  }

  function changeStatus(next: LeadStatus) {
    if (statusSaving || next === status) return;
    const priorStatus = status as LeadStatus;
    const requestId = ++statusRequestIdRef.current;
    statusInFlightRef.current = true;
    setStatus(next);
    setStatusSaving(true);
    setStatusError(null);
    startTransition(async () => {
      try {
        const result = await updateLeadStatus(lead.id, next, priorStatus);
        if (!mountedRef.current || requestId !== statusRequestIdRef.current) return;
        statusInFlightRef.current = false;
        if (!result.ok) {
          setStatus(priorStatus);
          setStatusError("Status changed in another tab. The latest server value is being loaded.");
        }
        router.refresh();
      } catch (error: unknown) {
        if (!mountedRef.current || requestId !== statusRequestIdRef.current) return;
        statusInFlightRef.current = false;
        setStatus(priorStatus);
        setStatusError(error instanceof Error ? error.message : "Could not update lead status");
        router.refresh();
      } finally {
        if (mountedRef.current && requestId === statusRequestIdRef.current) {
          setStatusSaving(false);
        }
      }
    });
  }

  function addTag() {
    const t = tagDraft.trim();
    if (!t || tags.includes(t)) { setTagDraft(""); return; }
    const next = [...tags, t];
    setTags(next);
    setTagDraft("");
    startTransition(() => {
      updateLeadTags(lead.id, next)
        .then((savedTags) => {
          if (mountedRef.current) setTags(savedTags);
        })
        .catch((error: unknown) => {
          console.error("Failed to add lead tag", { contactId: lead.id, error });
        });
    });
  }

  function removeTag(tag: string) {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    startTransition(() => {
      updateLeadTags(lead.id, next)
        .then((savedTags) => {
          if (mountedRef.current) setTags(savedTags);
        })
        .catch((error: unknown) => {
          console.error("Failed to remove lead tag", { contactId: lead.id, tag, error });
        });
    });
  }

  async function loadMore() {
    if (!cursor || loadingMore || timelineRefreshing) return;
    const requestId = ++timelineRequestIdRef.current;
    setLoadingMore(true);
    setTimelineError(null);
    try {
      const page = await getTimelinePage(lead.id, cursor);
      if (!mountedRef.current || requestId !== timelineRequestIdRef.current) return;
      setItems((cur) => [...cur, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error: unknown) {
      if (!mountedRef.current || requestId !== timelineRequestIdRef.current) return;
      console.error("Failed to load more lead timeline entries", { contactId: lead.id, error });
      setTimelineError(error instanceof Error ? error.message : "Could not load more activity");
    } finally {
      if (mountedRef.current && requestId === timelineRequestIdRef.current) {
        setLoadingMore(false);
      }
    }
  }

  const utm = lead.attribution ?? {};
  const hasAttribution = Object.keys(utm).length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 gap-3 shadow-sm">
        <Link href="/admin/contacts" className="text-slate-400 hover:text-primary" aria-label="Back to leads">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white truncate">
          {lead.name || lead.email}
        </h1>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${STATUS_STYLE[status] ?? "bg-slate-100 text-slate-600"}`}>
          {status}
        </span>
        {account && (
          <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            Has account
          </span>
        )}
        {pending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </header>

      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 flex gap-1 flex-shrink-0">
        {(
          [
            ["crm", "Lead"],
            ["track", "Track record"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-primary text-primary"
                : "border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        {tab === "track" ? (
          <div className="max-w-4xl mx-auto space-y-3">
            {trackRecord ? (
              <>
                <p className="text-xs text-slate-400">
                  Hub account linked to {account?.email ?? lead.email}.
                  {account && (
                    <>
                      {" "}
                      <Link href={`/students/${account.id}/track-record`} className="text-primary hover:underline">
                        Open full page
                      </Link>
                    </>
                  )}
                </p>
                {trackRecord}
              </>
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center">
                <p className="text-sm font-bold text-slate-500">No hub account matches {lead.email}</p>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Automatic links use normalized email addresses. Staff can also choose
                  an account manually from the lead details.
                </p>
              </div>
            )}
          </div>
        ) : (
        <div className="max-w-5xl mx-auto space-y-4">
          {lead.unsubscribedAt && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              <BellOff className="h-4 w-4 flex-shrink-0" />
              Unsubscribed {fmtDate(lead.unsubscribedAt)} — suppressed from all drip mail.
            </div>
          )}

          {/* AI brief — generated on demand only, never on page load */}
          <Card
            title="AI brief"
            aside={
              <button
                onClick={makeBrief}
                disabled={briefLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-500 hover:text-primary border border-slate-200 dark:border-slate-700 rounded-lg disabled:opacity-40"
              >
                {briefLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {briefLoading ? "Thinking…" : brief ? "Regenerate" : "Generate"}
              </button>
            }
          >
            {briefError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{briefError}</p>
            )}
            {brief ? (
              <div className="space-y-2 text-sm">
                <p className="text-slate-700 dark:text-slate-200">{brief.summary}</p>
                {brief.engagement && <p className="text-slate-500">{brief.engagement}</p>}
                {brief.nextAction && (
                  <p className="text-slate-900 dark:text-white font-semibold">
                    Next: {brief.nextAction}
                  </p>
                )}
                {brief.generatedAt && (
                  <p className="text-[11px] text-slate-400">
                    Generated {fmtDateTime(brief.generatedAt)} · AI-written from this record — verify before quoting.
                  </p>
                )}
              </div>
            ) : (
              !briefError && (
                <p className="text-xs text-slate-400">
                  No brief yet. Generate one to summarise this lead before reaching out.
                </p>
              )
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Identity */}
            <Card title="Contact">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <a href={`mailto:${lead.email}`} className="text-slate-700 dark:text-slate-200 hover:text-primary">{lead.email}</a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  {lead.phone
                    ? <a href={`tel:${lead.phone}`} className="text-slate-700 dark:text-slate-200 hover:text-primary">{lead.phone}</a>
                    : <span className="text-slate-400">No phone</span>}
                  {lead.phone && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                        dnc
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                          : lead.phoneConsentAt
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                      title={
                        dnc
                          ? "Automated calls suppressed. Human calls unaffected."
                          : lead.phoneConsentAt
                            ? `Call consent on record since ${fmtDate(lead.phoneConsentAt)}`
                            : "Number on file but no call consent — automated calls withheld"
                      }
                    >
                      {dnc ? "do not call" : lead.phoneConsentAt ? "call consent" : "no consent"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Marketing SMS: {lead.smsMarketingConsentAt ? "consented" : "not consented"}
                  {" · "}
                  Transactional SMS: {lead.smsTransactionalConsentAt ? "consented" : "not consented"}
                </div>
                <div className="flex items-center gap-2">
                  <Cake className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="date"
                    value={birthday}
                    onChange={(event) => changeBirthday(event.target.value)}
                    disabled={birthdaySaving}
                    aria-label="Birthday"
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                  {birthdaySaving && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                </div>
                {birthdayError && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                    {birthdayError}
                  </p>
                )}
                <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {account ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold text-slate-700 dark:text-slate-200">
                          {account.name?.trim() || "Hub account"}
                        </p>
                        <p className="truncate text-slate-400">{account.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={unlinkUser}
                        disabled={accountSaving}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                      >
                        Unlink
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={userQuery}
                          onChange={(event) => setUserQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void searchUsers();
                            }
                          }}
                          placeholder="Search account email"
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-800"
                        />
                        <button
                          type="button"
                          onClick={searchUsers}
                          disabled={accountSaving || userQuery.trim().length < 3}
                          className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
                        >
                          Search
                        </button>
                      </div>
                      {userResults.map((user) => (
                        <button
                          type="button"
                          key={user.id}
                          onClick={() => void linkUser(user)}
                          disabled={accountSaving}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left text-xs hover:border-primary/50 dark:border-slate-700"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-700 dark:text-slate-200">
                              {user.name?.trim() || "Unnamed user"}
                            </span>
                            <span className="block truncate text-slate-400">{user.email}</span>
                          </span>
                          <span className="font-semibold text-primary">Link</span>
                        </button>
                      ))}
                      {!accountSaving && userResults.length === 0 && userQuery.trim().length >= 3 && !accountError && (
                        <p className="text-xs text-slate-400">No matching users.</p>
                      )}
                    </div>
                  )}
                  {accountSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                  {accountError && (
                    <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                      {accountError}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-2 pt-1">
                  {lead.phone && (
                    <button
                      onClick={callWithAi}
                      disabled={callState !== "idle" || Boolean(callBlockedReason)}
                      title={callBlockedReason ?? "Place an AI voice call to this lead now"}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-40"
                    >
                      {callState === "calling"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Bot className="h-3 w-3" />}
                      {callState === "placed" ? "Calling…" : "Call with AI"}
                    </button>
                  )}
                  <div className="flex flex-col items-start gap-1">
                    <button
                      onClick={callWithBrowser}
                      disabled={Boolean(browserCallDisabledReason)}
                      title={browserCallDisabledReason ?? "Place a human-dialed browser call"}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-40"
                    >
                      {browserCallStarting
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <PhoneCall className="h-3 w-3" />}
                      {softphoneStatus === "in-call"
                        ? "Call in progress"
                        : softphoneStatus === "incoming"
                          ? "Incoming call"
                          : browserCallStarting
                            ? "Connecting…"
                            : "Call (browser)"}
                    </button>
                    <span className="text-[10px] text-slate-400">
                      human call — consent rules apply to automated calls only
                    </span>
                  </div>
                  {lead.phone && (
                    <button
                      onClick={toggleDnc}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 rounded-lg"
                      title="Toggle do-not-call for automated calls"
                    >
                      <PhoneOff className="h-3 w-3" /> {dnc ? "Allow AI calls" : "Do not call"}
                    </button>
                  )}
                </div>
                {callState === "placed" && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    AI call placed — the transcript will appear in Activity when the call ends.
                  </p>
                )}
                {callError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{callError}</p>
                )}
                {browserCallError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{browserCallError}</p>
                )}
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-xs text-slate-400">Status</span>
                  <select
                    value={status}
                    onChange={(e) => changeStatus(e.target.value as LeadStatus)}
                    className={`text-xs font-bold px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 ${STATUS_STYLE[status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {statusError !== null && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                    {statusError}
                  </p>
                )}
                <label className="flex items-center gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={excludedFromPipeline}
                    disabled={exclusionSaving}
                    onChange={(event) => void changePipelineExclusion(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-60"
                  />
                  Exclude from lead pipeline and pipeline reporting
                  {exclusionSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                </label>
                {exclusionError !== null && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                    {exclusionError}
                  </p>
                )}
                <p className="text-xs text-slate-400 pt-1">
                  Source: {lead.source ?? "unknown"} · Added {fmtDate(lead.createdAt)} · Last activity {fmtDate(lead.lastActivityAt)}
                </p>
              </dl>
            </Card>

            {/* Engagement */}
            <Card title="Email engagement">
              <div className="grid grid-cols-4 gap-2 text-center">
                {([["Sent", lead.engagement.sent], ["Opened", lead.engagement.opened],
                   ["Clicked", lead.engagement.clicked], ["Failed", lead.engagement.failed]] as const).map(([label, n]) => (
                  <div key={label}>
                    <p className="text-xl font-black text-slate-900 dark:text-white">{n}</p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                Opens are directional only — mail privacy features inflate them and image
                blocking hides them. Clicks are the number to trust.
              </p>
            </Card>
          </div>

          <Card title="1:1 bookings" aside={<CalendarClock className="h-4 w-4 text-slate-400" />}>
            {bookings.length === 0 ? (
              <p className="text-xs text-slate-400">No 1:1 bookings yet.</p>
            ) : (
              <ul className="space-y-2">
                {bookings.map((booking) => {
                  const cancelled = booking.status === "CANCELLED";
                  return (
                    <li
                      key={booking.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm"
                    >
                      <div className={cancelled ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}>
                        <span className="font-semibold">{fmtBookingWindow(booking)}</span>
                        <span className="text-xs"> with {booking.closerName}</span>
                      </div>
                      {booking.zoomJoinUrl ? (
                        <a
                          href={booking.zoomJoinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-xs font-semibold text-primary hover:underline ${cancelled ? "line-through opacity-60" : ""}`}
                        >
                          Join Zoom
                        </a>
                      ) : (
                        <span className={`text-xs text-slate-400 ${cancelled ? "line-through" : ""}`}>
                          Zoom link unavailable
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <OutreachComposer
            contactId={lead.id}
            contactName={lead.name}
            email={lead.email}
            phone={lead.phone}
            smsMarketingConsentAt={lead.smsMarketingConsentAt}
            smsTransactionalConsentAt={lead.smsTransactionalConsentAt}
            smsOptOutAt={lead.smsOptOutAt}
            unsubscribedAt={lead.unsubscribedAt}
            initialMessages={smsThread}
            initialJournal={lead.journal}
            onTimelineChange={setItems}
            onTimelineRefresh={refreshTimelinePageOne}
            onProfileRefresh={router.refresh}
          />

          {/* Tags */}
          <Card title="Tags">
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-primary/10 text-primary">
                  {t}
                  <button onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`} className="hover:text-rose-500">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-xs text-slate-400">No tags yet</span>}
              <span className="inline-flex items-center gap-1 ml-1">
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="Add tag…"
                  className="w-28 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button onClick={addTag} aria-label="Add tag" className="text-slate-400 hover:text-primary">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          </Card>

          {/* Ad attribution */}
          <Card title="Ad attribution (first touch)">
            {hasAttribution ? (
              <dl className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                {Object.entries(utm).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-400">{k}</dt>
                    <dd className="text-slate-700 dark:text-slate-200 break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-slate-400">No attribution captured for this lead.</p>
            )}
          </Card>

          {/* Drip campaigns */}
          <Card title="Drip campaigns">
            {lead.enrollments.length === 0 ? (
              <p className="text-xs text-slate-400">Never enrolled in a campaign.</p>
            ) : (
              <ul className="space-y-2">
                {lead.enrollments.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${DRIP_STATUS_STYLE[e.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {e.status}
                    </span>
                    <Link href={`/admin/contacts/campaigns/${e.campaignId}`} className="font-semibold text-slate-700 dark:text-slate-200 hover:text-primary">
                      {e.campaignName}
                    </Link>
                    <span className="text-xs text-slate-400">
                      step {e.lastStepOrder}/{e.stepCount}
                      {e.status === "ACTIVE" && e.nextRunAt && <> · next {fmtDate(e.nextRunAt)}</>}
                      {e.exitReason && <> · {e.exitReason}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Form responses — the reason this page exists */}
          <Card title="Form responses">
            {lead.responses.length === 0 ? (
              <p className="text-xs text-slate-400">No onboarding responses linked to this lead.</p>
            ) : (
              <div className="space-y-4">
                {lead.responses.map((r) => (
                  <div key={r.id}>
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      {r.formTitle}
                      <span className="ml-2 font-normal text-slate-400">{fmtDate(r.submittedAt)}</span>
                    </p>
                    <dl className="mt-2 space-y-1.5">
                      {r.answers.map((a, i) => (
                        <div key={i} className="grid md:grid-cols-[minmax(0,320px)_1fr] gap-1 md:gap-3 text-sm">
                          <dt className="text-slate-400 text-xs">{a.question}</dt>
                          <dd className="text-slate-700 dark:text-slate-200">{a.answers.join(", ")}</dd>
                        </div>
                      ))}
                      {r.answers.length === 0 && (
                        <p className="text-xs text-slate-400">Response recorded with no readable answers.</p>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="General notes">
            <details>
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                General notes (free-form scratchpad)
              </summary>
              <textarea
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
                onBlur={() => startTransition(() => { updateLeadNotes(lead.id, generalNotes).catch(() => {}); })}
                rows={4}
                placeholder="Unstructured notes. Saved when you click away."
                className="mt-2 w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </details>
          </Card>

          {/* Timeline */}
          <Card title="Activity">
            {timelineError !== null && (
              <p role="alert" className="mb-3 text-xs text-rose-600 dark:text-rose-400">
                {timelineError}
              </p>
            )}
            {items.length === 0 ? (
              <p className="text-xs text-slate-400">Nothing recorded yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {items.map((it, i) => {
                  const Icon = TIMELINE_ICON[it.kind] ?? StickyNote;
                  return (
                    <li key={`${it.at}-${i}`} className="flex gap-3 text-sm">
                      <Icon className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-slate-700 dark:text-slate-200">
                          {it.label}
                          {it.detail && <span className="text-slate-400"> — {it.detail}</span>}
                        </p>
                        {it.href && (
                          <a href={it.href} target="_blank" rel="noreferrer"
                             className="text-[11px] text-primary hover:underline break-all">
                            {it.href}
                          </a>
                        )}
                        {it.email && (
                          <div className="mt-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {it.email.campaignName && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                  {it.email.campaignName}
                                </span>
                              )}
                              {it.email.openedAt && (
                                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-600 dark:bg-sky-950 dark:text-sky-300">
                                  Opened {fmtDateTime(it.email.openedAt)}
                                </span>
                              )}
                              {it.email.clickedAt && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                  Clicked {fmtDateTime(it.email.clickedAt)}
                                </span>
                              )}
                            </div>
                            {it.email.clickedUrl && (
                              <a
                                href={it.email.clickedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block text-[11px] text-primary hover:underline break-all"
                              >
                                {it.email.clickedUrl}
                              </a>
                            )}
                            {it.email.bodyHtml && (
                              <details>
                                <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-primary">
                                  Email body
                                </summary>
                                {/* Sanitized server-side at send time; previewSafeHtml is
                                    the second belt for rows stored before that policy. */}
                                <div
                                  className="prose prose-sm mt-1 max-h-96 max-w-none overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                                  dangerouslySetInnerHTML={{
                                    __html: previewSafeHtml(it.email.bodyHtml),
                                  }}
                                />
                              </details>
                            )}
                          </div>
                        )}
                        {it.call && (
                          <div className="mt-1 space-y-1">
                            <p className="text-[11px] text-slate-400">
                              {[
                                callOutcomeLabel(it.call.outcome),
                                typeof it.call.durationSec === "number"
                                  ? `${Math.floor(it.call.durationSec / 60)}:${String(it.call.durationSec % 60).padStart(2, "0")} min`
                                  : null,
                                it.call.transferredTo ? `transferred to ${it.call.transferredTo}` : null,
                                it.call.authorLabel,
                              ].filter(Boolean).join(" · ")}
                            </p>
                            {it.call.recordingUrl && (
                              <a
                                href={it.call.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-primary hover:underline"
                              >
                                Recording
                              </a>
                            )}
                            {it.call.transcript && (
                              <details>
                                <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-primary">
                                  Transcript
                                </summary>
                                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2 text-[11px] text-slate-600 dark:text-slate-300 font-sans">
                                  {it.call.transcript}
                                </pre>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">{fmtDateTime(it.at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {cursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-4 w-full py-2 text-xs font-semibold text-slate-500 hover:text-primary border border-dashed border-slate-200 dark:border-slate-700 rounded-lg disabled:opacity-40"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </Card>
        </div>
        )}
      </main>
    </div>
  );
}
