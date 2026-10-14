"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { brand } from "@/config/brand";
import {
  Loader2,
  AlertTriangle,
  Plus,
  Trash2,
  Save,
  Search,
  UserPlus,
  StopCircle,
  Send,
} from "lucide-react";
import { LEAD_STATUSES } from "../../leadStatus";
import { tagLinksInHtml } from "@/lib/drip/link-utm";
import { previewSafeHtml } from "@/lib/outreach/previewSafeHtml";
import { COHORT_MESSAGE_TRIGGER, STEP_CHANNELS } from "@/lib/drip/constants";
import { TRIGGER_OPTIONS, triggerHelpNote } from "@/lib/drip/triggerOptions";
import type { DripSegment } from "@/lib/drip/segment";
import {
  updateCampaignSettings,
  updateCampaignSegment,
  previewSegment,
  addStep,
  updateStep,
  deleteStep,
  sendStepTest,
  enrollLead,
  stopLeadEnrollment,
  previewDripStepBodyAction,
} from "../actions";

/** "7d", "1d 2h", "45m" — human label for a cohort-start offset. */
function formatMinutesBefore(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d ? `${d}d` : "", h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

/** "3 (43%)" — count first, because a bare percentage of 2 sends misleads. */
function pct(count: number, total: number): string {
  if (total === 0) return "0";
  return `${count} (${Math.round((count / total) * 100)}%)`;
}

export interface CampaignStepDetail {
  id: string;
  order: number;
  delayHours: number;
  /** ENROLLMENT | COHORT_START — see prisma DripStep.anchor. */
  anchor: string;
  /** Minutes relative to cohort start; negative = before. COHORT_START only. */
  offsetMinutes: number;
  channel: string;
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  callAssistantId: string;
  callFirstMessage: string;
  /**
   * Per-step funnel. Two denominators, deliberately:
   *   `reached`   — SENT + FAILED + SKIPPED. Everyone the sequence carried past
   *                 this step, since the enrollment cursor advances regardless
   *                 of send outcome. Retention measures against this.
   *   `delivered` — SENT only. The honest denominator for open/click/unsub.
   *
   * `taskLogged` is SKIPPED, i.e. a TASK-channel step: an internal reminder, no
   * mail intended. It is not a failure and must never be coloured like one.
   *
   * Opens are directional only — Apple Mail Privacy Protection and image proxies
   * inflate them, image-blocking clients suppress them. Clicks are trustworthy.
   */
  funnel: StepFunnelView;
}

export interface StepFunnelView {
  order: number;
  reached: number;
  delivered: number;
  failed: number;
  taskLogged: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  waiting: number;
  paused: number;
  stepRetentionPct: number | null;
  cumulativeRetentionPct: number | null;
}

export interface CampaignFunnelTotals {
  waitingTotal: number;
  dueNow: number;
  failedTotal: number;
  unsubscribedTotal: number;
  hasInvertedStep: boolean;
}

export interface CampaignDetail {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  /** Validated against CAMPAIGN_TRIGGERS — see prisma DripCampaign.trigger. */
  trigger: string;
  priority: number;
  autoEnroll: boolean;
  timezone: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  skipWeekends: boolean;
  exitOnStatuses: string[];
  testEmail: string | null;
  segment: DripSegment;
  steps: CampaignStepDetail[];
  funnelTotals: CampaignFunnelTotals;
  recovered: { buyers: number; revenueCents: number };
}

export interface EnrollmentRow {
  id: string;
  name: string;
  email: string;
  status: string;
  lastStepOrder: number;
  nextRunAt: string | null;
  exitReason: string | null;
}

export interface SendRow {
  id: string;
  stepOrder: number;
  email: string;
  status: string;
  sentAt: string;
  error: string | null;
}

export interface PreviewMergeContext {
  name: string;
  email: string;
  unsubscribeUrl: string;
  appUrl: string;
  campaignSlug: string;
  /** Keyed by step order — see the comment where this is built in page.tsx. */
  perStepUpcomingCohortsHtml: Record<number, string>;
  nextCohortLine: string;
}

type Counts = { active: number; completed: number; exited: number; paused: number };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first || first.toLowerCase() === "lead") return "there";
  return first;
}


const parseList = (text: string): string[] =>
  text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const listToText = (list: string[] | undefined): string => (list ?? []).join(", ");

export default function CampaignEditor({
  campaign,
  enrollments,
  sends,
  counts,
  previewMergeContext,
}: {
  campaign: CampaignDetail;
  enrollments: EnrollmentRow[];
  sends: SendRow[];
  counts: Counts;
  previewMergeContext: PreviewMergeContext;
}) {
  return (
    <div className="space-y-4">
      <SettingsCard campaign={campaign} />
      {/* COHORT_SCHEDULE campaigns are enrolled by cohort registration, not by
          segment — showing the segment editor would imply a rule that is ignored. */}
      {campaign.trigger !== "COHORT_SCHEDULE" && (
        <SegmentCard campaignId={campaign.id} segment={campaign.segment} />
      )}
      <FunnelCard
        steps={campaign.steps}
        totals={campaign.funnelTotals}
        recovered={campaign.recovered}
      />
      <StepsCard
        campaignId={campaign.id}
        steps={campaign.steps}
        testEmail={campaign.testEmail}
        previewMergeContext={previewMergeContext}
        cohortTriggered={campaign.trigger === "COHORT_SCHEDULE"}
      />
      <EnrollmentsCard campaignId={campaign.id} enrollments={enrollments} counts={counts} />
      <SendsCard sends={sends} />
    </div>
  );
}

// ─── Settings ──────────────────────────────────────────────────────────

function SettingsCard({ campaign }: { campaign: CampaignDetail }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const [trigger, setTrigger] = useState(campaign.trigger);
  const [autoEnroll, setAutoEnroll] = useState(campaign.autoEnroll);
  const [priority, setPriority] = useState(campaign.priority);
  const [timezone, setTimezone] = useState(campaign.timezone);
  const [startHour, setStartHour] = useState(campaign.sendWindowStartHour);
  const [endHour, setEndHour] = useState(campaign.sendWindowEndHour);
  const [skipWeekends, setSkipWeekends] = useState(campaign.skipWeekends);
  const [exitOn, setExitOn] = useState<string[]>(campaign.exitOnStatuses);
  const [testEmail, setTestEmail] = useState(campaign.testEmail ?? "");

  function toggleExit(status: string) {
    setExitOn((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateCampaignSettings(campaign.id, {
          name,
          description,
          trigger,
          autoEnroll,
          priority,
          timezone,
          sendWindowStartHour: startHour,
          sendWindowEndHour: endHour,
          skipWeekends,
          exitOnStatuses: exitOn,
          testEmail,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <Card title="Settings" subtitle={`Slug: ${campaign.slug}`}>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Priority (lower wins ties)">
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className={inputClass}
          />
        </Field>
        <Field label="Description" full>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </Field>
        <Field label="Trigger" full>
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            disabled={campaign.trigger === COHORT_MESSAGE_TRIGGER}
            className={inputClass}
          >
            {campaign.trigger === COHORT_MESSAGE_TRIGGER && (
              <option value={COHORT_MESSAGE_TRIGGER} disabled>
                Cohort message (managed from the cohort message composer)
              </option>
            )}
            {TRIGGER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {triggerHelpNote(trigger) && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {triggerHelpNote(trigger)}
            </p>
          )}
        </Field>
        <Field label="Timezone (IANA)">
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/Los_Angeles"
            className={inputClass}
          />
        </Field>
        <Field label="Auto-enroll matching leads">
          <label className="flex items-center gap-2 h-11 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={autoEnroll}
              onChange={(e) => setAutoEnroll(e.target.checked)}
              className="h-4 w-4"
            />
            Enroll automatically on each tick
          </label>
        </Field>
        <Field label="Send window (local hour, 0–24)">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={23}
              value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
              className={`${inputClass} w-20`}
            />
            <span className="text-slate-400">to</span>
            <input
              type="number"
              min={1}
              max={24}
              value={endHour}
              onChange={(e) => setEndHour(Number(e.target.value))}
              className={`${inputClass} w-20`}
            />
          </div>
        </Field>
        <Field label="Weekends">
          <label className="flex items-center gap-2 h-11 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={skipWeekends}
              onChange={(e) => setSkipWeekends(e.target.checked)}
              className="h-4 w-4"
            />
            Skip Saturday and Sunday
          </label>
        </Field>
        <Field label="Test email (for per-step test sends)" full>
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Save this, then use “Send test” on any step to see the real email in your inbox.
            Test sends skip enrollment and the send window, and are not recorded as campaign
            sends.
          </p>
        </Field>
        <Field label="Exit campaign when status becomes" full>
          <div className="flex flex-wrap gap-2">
            {LEAD_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => toggleExit(status)}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors min-h-[36px] ${
                  exitOn.includes(status)
                    ? "bg-primary text-white border-primary"
                    : "bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex items-center gap-3 pt-1">
        <SaveButton pending={pending} onClick={save} />
        {saved && <span className="text-xs font-semibold text-emerald-600">Saved.</span>}
      </div>
    </Card>
  );
}

// ─── Segment ───────────────────────────────────────────────────────────

function SegmentCard({
  campaignId,
  segment,
}: {
  campaignId: string;
  segment: DripSegment;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [previewing, startPreview] = useTransition();

  const [sources, setSources] = useState(listToText(segment.sources));
  const [statuses, setStatuses] = useState<string[]>(segment.statuses ?? []);
  const [anyTags, setAnyTags] = useState(listToText(segment.anyTags));
  const [allTags, setAllTags] = useState(listToText(segment.allTags));
  const [noneTags, setNoneTags] = useState(listToText(segment.noneTags));
  const [minAgeHours, setMinAgeHours] = useState(segment.minAgeHours?.toString() ?? "");
  const [maxAgeDays, setMaxAgeDays] = useState(segment.maxAgeDays?.toString() ?? "");
  const [inactiveForDays, setInactiveForDays] = useState(
    segment.inactiveForDays?.toString() ?? ""
  );

  function toggleStatus(status: string) {
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  const built: DripSegment = useMemo(() => {
    const out: DripSegment = {};
    const s = parseList(sources);
    const st = statuses;
    const any = parseList(anyTags);
    const all = parseList(allTags);
    const none = parseList(noneTags);
    if (s.length) out.sources = s;
    if (st.length) out.statuses = st;
    if (any.length) out.anyTags = any;
    if (all.length) out.allTags = all;
    if (none.length) out.noneTags = none;
    const minH = Number(minAgeHours);
    if (minAgeHours && Number.isFinite(minH) && minH > 0) out.minAgeHours = Math.floor(minH);
    const maxD = Number(maxAgeDays);
    if (maxAgeDays && Number.isFinite(maxD) && maxD > 0) out.maxAgeDays = Math.floor(maxD);
    const inactD = Number(inactiveForDays);
    if (inactiveForDays && Number.isFinite(inactD) && inactD > 0) {
      out.inactiveForDays = Math.floor(inactD);
    }
    return out;
  }, [sources, statuses, anyTags, allTags, noneTags, minAgeHours, maxAgeDays, inactiveForDays]);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateCampaignSegment(campaignId, built);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  function runPreview() {
    setPreview(null);
    startPreview(async () => {
      try {
        const count = await previewSegment(built);
        setPreview(count);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <Card
      title="Audience segment"
      subtitle="Evaluated once, at enrollment. Ongoing exits are driven by the status list above."
    >
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Sources (comma-separated; onboarding:* wildcard)" full>
          <input
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            placeholder="onboarding:*, asset_download"
            className={inputClass}
          />
        </Field>
        <Field label="Lead status" full>
          <div className="flex flex-wrap gap-2">
            {LEAD_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-colors min-h-[36px] ${
                  statuses.includes(status)
                    ? "bg-primary text-white border-primary"
                    : "bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Any of these tags">
          <input value={anyTags} onChange={(e) => setAnyTags(e.target.value)} className={inputClass} />
        </Field>
        <Field label="All of these tags">
          <input value={allTags} onChange={(e) => setAllTags(e.target.value)} className={inputClass} />
        </Field>
        <Field label="None of these tags">
          <input value={noneTags} onChange={(e) => setNoneTags(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Minimum age (hours)">
          <input
            type="number"
            min={0}
            value={minAgeHours}
            onChange={(e) => setMinAgeHours(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Maximum age (days)">
          <input
            type="number"
            min={0}
            value={maxAgeDays}
            onChange={(e) => setMaxAgeDays(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Inactive for at least (days)">
          <input
            type="number"
            min={0}
            value={inactiveForDays}
            onChange={(e) => setInactiveForDays(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <SaveButton pending={pending} onClick={save} />
        <button
          type="button"
          onClick={runPreview}
          disabled={previewing}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Preview audience
        </button>
        {preview !== null && (
          <span className="text-sm text-slate-600 dark:text-slate-300">
            <strong>{preview}</strong> matching lead{preview === 1 ? "" : "s"} right now
          </span>
        )}
        {saved && <span className="text-xs font-semibold text-emerald-600">Saved.</span>}
      </div>
    </Card>
  );
}

// ─── Funnel ────────────────────────────────────────────────────────────

/**
 * One row per step, above the step list rather than inside it.
 *
 * A StepRow is a full editing form — roughly 400-500px tall — so on a 7-step
 * campaign you cannot see step 1's numbers and step 6's numbers at once. Since
 * comparing adjacent steps IS the funnel, inline-only stats make the one
 * operation that matters impossible. Hence a compact table here, and only the
 * alarms (failed / waiting) left inline on each step.
 */
function FunnelCard({
  steps,
  totals,
  recovered,
}: {
  steps: CampaignStepDetail[];
  totals: CampaignFunnelTotals;
  recovered: { buyers: number; revenueCents: number };
}) {
  const anySends = steps.some((s) => s.funnel.reached > 0);

  return (
    <Card
      title="Funnel"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>waiting {totals.waitingTotal}</span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span
            className={
              totals.dueNow > 0 ? "text-rose-600 dark:text-rose-400 font-bold" : undefined
            }
            title={
              totals.dueNow > 0
                ? "Enrollments whose next step is already due. If this stays above zero, the drip tick is not running."
                : undefined
            }
          >
            due now {totals.dueNow}
          </span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span
            className={
              totals.failedTotal > 0 ? "text-rose-600 dark:text-rose-400 font-bold" : undefined
            }
          >
            failed {totals.failedTotal}
          </span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span>unsubscribed {totals.unsubscribedTotal}</span>
          {recovered.buyers > 0 ? (
            <>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span
                className="font-bold text-emerald-600 dark:text-emerald-400"
                title="Enrolled contacts who paid after they enrolled. Attribution, not proof of causation — some would have bought anyway."
              >
                {recovered.buyers} bought · $
                {(recovered.revenueCents / 100).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </>
          ) : null}
        </span>
      }
    >
      {!anySends && totals.waitingTotal === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">
          No sends yet — the funnel fills in once this campaign is active.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest font-black text-slate-400">
                  <th className="px-2 py-1.5">Step</th>
                  <th className="px-2 py-1.5" title="Everyone the sequence carried past this step — delivered, failed, or an internal task.">
                    Reached
                  </th>
                  <th className="px-2 py-1.5" title="Contacts parked here right now, awaiting this step's send.">
                    Waiting
                  </th>
                  <th className="px-2 py-1.5">Sent</th>
                  <th className="px-2 py-1.5">Failed</th>
                  <th className="px-2 py-1.5" title="Recipients who opened at least once. Inflated by Apple Mail Privacy Protection and suppressed by image blocking — directional only.">
                    Opened
                  </th>
                  <th className="px-2 py-1.5" title="Recipients who clicked at least once. The trustworthy engagement signal.">
                    Clicked
                  </th>
                  <th className="px-2 py-1.5" title="Attributed to the last email we sent this contact, which may belong to a different campaign.">
                    Unsub
                  </th>
                  <th className="px-2 py-1.5" title="Of everyone who reached the previous step, how many reached this one.">
                    Keep
                  </th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => {
                  const f = step.funnel;
                  const isTask = step.channel === "TASK";
                  const isCall = step.channel === "CALL";
                  const isSms = step.channel === "SMS";
                  return (
                    <tr key={step.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1.5 font-semibold text-slate-800 dark:text-slate-100">
                        {step.order}
                        {isTask && (
                          <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            task
                          </span>
                        )}
                        {isCall && (
                          <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            call
                          </span>
                        )}
                        {isSms && (
                          <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            sms
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs font-semibold">{f.reached}</td>
                      <td className="px-2 py-1.5 text-xs">{f.waiting || "—"}</td>
                      {/* A TASK step sends no mail, so a zero here would read as
                          failure rather than "not applicable". */}
                      <td className="px-2 py-1.5 text-xs">{isTask ? "—" : f.delivered}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {f.failed > 0 ? (
                          <span className="inline-block px-1.5 py-0.5 rounded font-bold bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                            {f.failed}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/* Opens/clicks/unsubs are email concepts. CALL and SMS
                          engagement lives on the lead profile instead. */}
                      <td className="px-2 py-1.5 text-xs">
                        {isTask || isCall || isSms ? "—" : pct(f.opened, f.delivered)}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                        {isTask || isCall || isSms ? "—" : pct(f.clicked, f.delivered)}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {isTask || isCall || isSms ? "—" : f.unsubscribed || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {f.stepRetentionPct === null ? "—" : `${f.stepRetentionPct}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totals.hasInvertedStep && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              A later step has reached more contacts than an earlier one — the step order or step
              set changed after sending began, so retention across that change is not comparable
              and is shown as “—”.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

// ─── Steps ─────────────────────────────────────────────────────────────

function StepsCard({
  campaignId,
  steps,
  testEmail,
  previewMergeContext,
  cohortTriggered,
}: {
  campaignId: string;
  steps: CampaignStepDetail[];
  testEmail: string | null;
  previewMergeContext: PreviewMergeContext;
  cohortTriggered: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Cumulative offset from enrollment, shown as "day N" so authors can see
  // real-world sequence timing without adding up delayHours by hand.
  const cumulative = useMemo(() => {
    const totals: number[] = [];
    steps.reduce((total, s) => {
      const next = total + s.delayHours;
      totals.push(next);
      return next;
    }, 0);
    return totals;
  }, [steps]);

  function addOne() {
    setError(null);
    startTransition(async () => {
      try {
        await addStep(campaignId);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <Card
      title={`Steps (${steps.length})`}
      subtitle="Delay is measured from the previous step's send — order 1 from enrollment."
    >
      {error && <ErrorBanner message={error} />}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            cumulativeHours={cumulative[i]}
            testEmail={testEmail}
            previewMergeContext={previewMergeContext}
            cohortTriggered={cohortTriggered}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={addOne}
        disabled={pending}
        className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors min-h-[44px]"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add step
      </button>
    </Card>
  );
}

function StepRow({
  step,
  cumulativeHours,
  testEmail,
  previewMergeContext,
  cohortTriggered,
}: {
  step: CampaignStepDetail;
  cumulativeHours: number;
  testEmail: string | null;
  previewMergeContext: PreviewMergeContext;
  cohortTriggered: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [delayHours, setDelayHours] = useState(step.delayHours);
  const [anchor, setAnchor] = useState(step.anchor);
  // Edited as positive "minutes before start"; stored negative.
  const [minutesBefore, setMinutesBefore] = useState(Math.abs(step.offsetMinutes));
  const [channel, setChannel] = useState(step.channel);
  const [subject, setSubject] = useState(step.subject);
  const [body, setBody] = useState(step.body);
  const [ctaLabel, setCtaLabel] = useState(step.ctaLabel);
  const [ctaUrl, setCtaUrl] = useState(step.ctaUrl);
  const [callAssistantId, setCallAssistantId] = useState(step.callAssistantId);
  const [callFirstMessage, setCallFirstMessage] = useState(step.callFirstMessage);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const isCall = channel === "CALL";
  const isSms = channel === "SMS";
  const smsSegmentCount = Math.ceil(body.length / 160);

  // Server-rendered preview through the real merge pipeline (debounced while typing).
  useEffect(() => {
    if (!showPreview || isCall || isSms) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewDripStepBodyAction({
        body,
        campaignSlug: previewMergeContext.campaignSlug,
        stepOrder: step.order,
        upcomingCohortsHtml: previewMergeContext.perStepUpcomingCohortsHtml[step.order] ?? "",
        nextCohortLine: previewMergeContext.nextCohortLine,
      }).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setPreviewHtml(result.html);
          setPreviewError(null);
        } else {
          setPreviewError(result.error);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showPreview, isCall, isSms, body, step.order, previewMergeContext]);

  const days = Math.floor(cumulativeHours / 24);
  const hours = cumulativeHours % 24;
  const cumulativeLabel =
    anchor === "COHORT_START"
      ? minutesBefore === 0
        ? "at cohort start"
        : `${formatMinutesBefore(minutesBefore)} before cohort start`
      : cumulativeHours === 0
        ? "immediately at enrollment"
        : `day ${days}${hours ? ` +${hours}h` : ""} from enrollment`;

  function save() {
    setError(null);
    setSaved(false);
    setWarnings([]);
    startTransition(async () => {
      try {
        const result = await updateStep(step.id, {
          delayHours,
          anchor,
          offsetMinutes: -Math.abs(minutesBefore),
          channel,
          subject,
          body,
          ctaLabel,
          ctaUrl,
          callAssistantId,
          callFirstMessage,
        });
        setWarnings(result.warnings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setWarnings([]);
        setError(errorMessage(e));
      }
    });
  }

  // Sends what is SAVED, not what is on screen — save edits first or the test
  // shows the previous version. Said plainly in the button's helper text.
  function sendTest() {
    setError(null);
    setTestResult(null);
    startTransition(async () => {
      try {
        const result = await sendStepTest(step.id);
        setTestResult(result.ok ? `Sent to ${result.to}.` : result.reason);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  function remove() {
    if (!confirm(`Delete step ${step.order} ("${step.subject}")? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteStep(step.id);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 md:p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
          Step {step.order}
        </span>
        <span className="text-xs text-slate-500">— {cumulativeLabel}</span>
        {/* Alarms only. The rates live in the Funnel card above, where adjacent
            steps can actually be compared; what you need while editing THIS
            step is whether it is broken or holding people up. */}
        {step.funnel.failed > 0 && (
          <span
            className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            title="Sends that failed on this step. Failures are not retried — the enrollment moves on regardless."
          >
            {step.funnel.failed} failed
          </span>
        )}
        {step.funnel.waiting > 0 && (
          <span
            className="text-[11px] font-semibold text-slate-500 dark:text-slate-400"
            title="Contacts parked here right now, awaiting this step's send."
          >
            {step.funnel.waiting} waiting
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {channel === "EMAIL" && (
            <button
              type="button"
              onClick={sendTest}
              disabled={pending || !testEmail}
              title={
                testEmail
                  ? `Send this step to ${testEmail}. Sends the saved version — save edits first.`
                  : "Set a test email in Settings first"
              }
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-40 min-h-[32px]"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send test
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg disabled:opacity-50 min-h-[32px]"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {(testResult || warnings.length > 0) && (
        <div className="space-y-1">
          {testResult && (
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{testResult}</p>
          )}
          {warnings.map((warning) => (
            <p key={warning} className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-3">
        {cohortTriggered ? (
          <Field label="Timing">
            <div className="flex items-center gap-2">
              <select
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                className={inputClass}
              >
                <option value="ENROLLMENT">On registration</option>
                <option value="COHORT_START">Before cohort start</option>
              </select>
              {anchor === "COHORT_START" && (
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={minutesBefore}
                  onChange={(e) => setMinutesBefore(Math.max(0, Number(e.target.value)))}
                  title="Minutes before cohort start (10080 = 7 days, 1440 = 1 day, 120 = 2 hours)"
                  className={`${inputClass} w-28`}
                />
              )}
            </div>
            {anchor === "COHORT_START" && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Minutes before start — 10080 = 7d, 1440 = 1d, 120 = 2h.
              </p>
            )}
          </Field>
        ) : (
          <Field label="Delay (hours since prior step)">
            <input
              type="number"
              min={0}
              value={delayHours}
              onChange={(e) => setDelayHours(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        )}
        <Field label="Channel">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className={inputClass}
          >
            {STEP_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c === "EMAIL"
                  ? "Email"
                  : c === "CALL"
                    ? "AI call (Vapi voice agent)"
                    : c === "SMS"
                      ? "SMS (text message)"
                      : "Task (internal reminder, no send)"}
              </option>
            ))}
          </select>
        </Field>
        {!isCall && !isSms && (
          <>
            <Field label="CTA label" full={false}>
              <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className={inputClass} />
            </Field>
            <Field label="CTA URL">
              <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className={inputClass} />
            </Field>
          </>
        )}
      </div>

      <Field
        label={
          isCall
            ? "Step label (internal — not heard by the lead)"
            : isSms
              ? "Internal label (not sent to the lead)"
              : "Subject"
        }
        full
      >
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
      </Field>

      {isCall && (
        <>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Vapi assistant ID (blank = default assistant)">
              <input
                value={callAssistantId}
                onChange={(e) => setCallAssistantId(e.target.value)}
                placeholder="Uses VAPI_DEFAULT_ASSISTANT_ID"
                className={inputClass}
              />
            </Field>
            <Field label="Opening line override (blank = assistant default)">
              <input
                value={callFirstMessage}
                onChange={(e) => setCallFirstMessage(e.target.value)}
                placeholder={`Hi {name}, this is the AI assistant from ${brand.wordmark}…`}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Calls only go to leads with a valid number, call consent, and no
            do-not-call flag; consent is re-checked at dial time. Regardless of the
            campaign send window, calls are clamped to 10:00–18:00 campaign time,
            Mon–Fri. The transcript lands on the lead profile when the call ends.
          </p>
        </>
      )}

      {isSms && (
        <>
          <Field label="Message (plain text)" full>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={640}
              className={inputClass}
            />
            <p
              className={`mt-1 text-xs ${
                body.length > 320
                  ? "font-semibold text-amber-600 dark:text-amber-400"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {body.length} / 640 characters
              {body.length > 320 ? ` — will send as ${smsSegmentCount} segments` : ""}
            </p>
          </Field>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {"Sent 9:00–20:00 campaign time. Only to leads with phone consent who haven't texted STOP. Merge fields: {{first_name}}, {{booking_url}}."}
          </p>
        </>
      )}

      {!isCall && !isSms && (
        <Field label="Body (HTML)" full>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className={`${inputClass} font-mono text-xs`}
          />
        </Field>
      )}

      {!isCall && !isSms && (
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-xs font-semibold text-primary hover:underline"
        >
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      )}
      {!isCall && !isSms && showPreview && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-4 bg-slate-50 dark:bg-slate-950 text-sm">
          {previewError ? (
            <p className="text-xs text-red-600">{previewError}</p>
          ) : previewHtml === null ? (
            <p className="text-xs text-slate-500">Rendering preview…</p>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: previewSafeHtml(previewHtml) }} />
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="flex items-center gap-3">
        <SaveButton pending={pending} onClick={save} label="Save step" />
        {saved && <span className="text-xs font-semibold text-emerald-600">Saved.</span>}
      </div>
    </div>
  );
}

// ─── Enrollments ─────────────────────────────────────────────────────

function EnrollmentsCard({
  campaignId,
  enrollments,
  counts,
}: {
  campaignId: string;
  enrollments: EnrollmentRow[];
  counts: Counts;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [enrollResult, setEnrollResult] = useState<string | null>(null);

  function enroll() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setError(null);
    setEnrollResult(null);
    startTransition(async () => {
      try {
        const result = await enrollLead(campaignId, trimmed);
        if (result.ok) {
          setEnrollResult(`Enrolled ${trimmed}.`);
          setEmail("");
        } else {
          setEnrollResult(result.reason);
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  function stop(enrollmentId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await stopLeadEnrollment(enrollmentId, campaignId);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <Card
      title="Enrollments"
      subtitle={`active ${counts.active} · completed ${counts.completed} · exited ${counts.exited} · paused ${counts.paused}`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enroll()}
          placeholder="lead@email.com"
          className={`${inputClass} flex-1 min-w-[220px]`}
        />
        <button
          type="button"
          onClick={enroll}
          disabled={pending}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Enroll by email
        </button>
        {enrollResult && <span className="text-xs text-slate-500">{enrollResult}</span>}
      </div>

      {error && <ErrorBanner message={error} />}

      {enrollments.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">No enrollments yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest font-black text-slate-400">
                <th className="px-2 py-1.5">Lead</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Step</th>
                <th className="px-2 py-1.5">Next run</th>
                <th className="px-2 py-1.5">Exit reason</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1.5">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{e.name}</div>
                    <div className="text-xs text-slate-400">{e.email}</div>
                  </td>
                  <td className="px-2 py-1.5 text-xs font-bold">{e.status}</td>
                  <td className="px-2 py-1.5 text-xs">{e.lastStepOrder}</td>
                  <td className="px-2 py-1.5 text-xs">{fmtDateTime(e.nextRunAt)}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-400">{e.exitReason ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    {e.status === "ACTIVE" && (
                      <button
                        type="button"
                        onClick={() => stop(e.id)}
                        disabled={pending}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg px-2 py-1 disabled:opacity-50 min-h-[32px]"
                      >
                        <StopCircle className="h-3.5 w-3.5" /> Stop
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Sends ─────────────────────────────────────────────────────────────

function SendsCard({ sends }: { sends: SendRow[] }) {
  return (
    <Card title="Recent sends" subtitle="Last 50, most recent first">
      {sends.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">Nothing sent yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest font-black text-slate-400">
                <th className="px-2 py-1.5">Step</th>
                <th className="px-2 py-1.5">Lead</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Sent</th>
                <th className="px-2 py-1.5">Error</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1.5 text-xs">{s.stepOrder}</td>
                  <td className="px-2 py-1.5 text-xs">{s.email}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        s.status === "SENT"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : s.status === "FAILED"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-400">{fmtDateTime(s.sentAt)}</td>
                  <td className="px-2 py-1.5 text-xs text-rose-500 max-w-[220px] truncate" title={s.error ?? ""}>
                    {s.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────

const inputClass =
  "w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[44px]";

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  // ReactNode, not string: the funnel card colours individual metrics inside
  // its subtitle (rose when due-now or failed is non-zero).
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 md:p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          {title}
        </h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block space-y-1 ${full ? "md:col-span-2" : ""}`}>
      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function SaveButton({
  pending,
  onClick,
  label = "Save",
}: {
  pending: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors min-h-[44px]"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900 rounded-lg px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      {message}
    </p>
  );
}
