"use client";

import { useState, useTransition } from "react";
import {
  syncAction,
  draftOutreachAction,
  approveOutreachAction,
  sendOutreachAction,
  nudgeAction,
  proposeScheduleAction,
  scheduleLinkAction,
} from "./actions";
import SessionPicker, { type PickerSession } from "./SessionPicker";

type SessionResponse = { sessionId: string; title: string; date: string; availability: string; note: string | null };
type InstructorRow = {
  cohortInstructorId: string;
  instructorId: string;
  name: string | null;
  email: string;
  status: string;
  invitedAt: string | null;
  respondedAt: string | null;
  notes: string | null;
  responseToken: string;
  assignedSessionIds: string[];
  unansweredSessionIds: string[];
  sessionResponses: SessionResponse[];
};
type CohortRow = {
  cohortId: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sessionCount: number;
  sessions: PickerSession[];
  unconfirmedCount: number;
  instructors: InstructorRow[];
};
type OutreachRow = {
  id: string;
  cohortId: string;
  subject: string;
  status: string;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  sendCount: number;
};

const STATUS_BADGE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  DECLINED: "bg-rose-100 text-rose-800",
};

const AVAIL_DOT: Record<string, string> = {
  AVAILABLE: "bg-emerald-500",
  TENTATIVE: "bg-amber-500",
  UNAVAILABLE: "bg-rose-500",
  UNKNOWN: "bg-slate-300",
};

export default function ParticipationClient({
  cohorts,
  outreaches,
}: {
  cohorts: CohortRow[];
  outreaches: OutreachRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // cohortInstructorId whose session picker is open, or null.
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; result?: unknown }>, label: string) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fn();
        setMessage(res.ok ? `${label}: done${res.result ? ` — ${JSON.stringify(res.result)}` : ""}` : `${label}: ${res.error}`);
      } catch (e) {
        setMessage(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD";

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Instructor participation</h1>
      <p className="mt-1 text-sm text-slate-500">
        Published cohorts × instructors × confirmation. Workflow: Sync → Draft → Approve → Send → Nudge.
      </p>

      {message && (
        <p className="mt-4 rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-2 text-sm text-slate-700 dark:text-slate-200">
          {message}
        </p>
      )}

      {cohorts.length === 0 && (
        <p className="mt-8 text-sm text-slate-500">No cohorts in ENROLLMENT or IN_PROGRESS.</p>
      )}

      <div className="mt-6 space-y-6">
        {cohorts.map((cohort) => {
          const cohortOutreaches = outreaches.filter((o) => o.cohortId === cohort.cohortId);
          const latest = cohortOutreaches[0];
          return (
            <div key={cohort.cohortId} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900 dark:text-white">{cohort.title}</h2>
                  <p className="text-xs text-slate-500">
                    {cohort.status} · {fmt(cohort.startDate)}–{fmt(cohort.endDate)} · {cohort.sessionCount} sessions ·{" "}
                    <span className={cohort.unconfirmedCount ? "font-bold text-amber-600" : "text-emerald-600"}>
                      {cohort.unconfirmedCount ? `${cohort.unconfirmedCount} unconfirmed` : "all confirmed"}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button disabled={pending} onClick={() => run(() => syncAction(cohort.cohortId), "Sync")}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
                    Sync roster
                  </button>
                  <button disabled={pending} onClick={() => run(() => proposeScheduleAction(cohort.cohortId), "Propose schedule")}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
                    Propose sessions
                  </button>
                  <button disabled={pending} onClick={() => run(() => draftOutreachAction(cohort.cohortId), "Draft")}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
                    Draft outreach
                  </button>
                  {latest?.status === "DRAFT" && (
                    <button disabled={pending} onClick={() => run(() => approveOutreachAction(latest.id), "Approve")}
                      className="rounded-lg bg-violet-700 px-3 py-1.5 font-semibold text-white hover:opacity-90">
                      Approve
                    </button>
                  )}
                  {latest && latest.status !== "DRAFT" && (
                    <button disabled={pending} onClick={() => run(() => sendOutreachAction(latest.id), "Send")}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:opacity-90">
                      Send
                    </button>
                  )}
                  <button disabled={pending} onClick={() => run(() => nudgeAction(cohort.cohortId), "Nudge")}
                    className="rounded-lg border border-amber-300 px-3 py-1.5 font-semibold text-amber-700 hover:bg-amber-50">
                    Nudge pending
                  </button>
                </div>
              </div>

              {latest && (
                <p className="mt-2 text-xs text-slate-400">
                  Latest outreach: “{latest.subject}” · {latest.status} · {latest.sendCount} send record(s)
                </p>
              )}

              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-4">Instructor</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Invited</th>
                    <th className="py-2 pr-4">Sessions</th>
                    <th className="py-2">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {cohort.instructors.map((instructor) => (
                    <tr key={instructor.cohortInstructorId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-4">
                        <p className="font-semibold text-slate-900 dark:text-white">{instructor.name ?? instructor.email}</p>
                        <p className="text-xs text-slate-500">{instructor.email}</p>
                        {instructor.notes && <p className="text-xs italic text-slate-500">“{instructor.notes}”</p>}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_BADGE[instructor.status] ?? ""}`}>
                          {instructor.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-500">
                        {instructor.invitedAt ? new Date(instructor.invitedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1" title={instructor.sessionResponses.map((s) => `${s.title}: ${s.availability}`).join("\n")}>
                            {instructor.sessionResponses.length
                              ? instructor.sessionResponses.map((s) => (
                                  <span key={s.sessionId} className={`h-2.5 w-2.5 rounded-full ${AVAIL_DOT[s.availability] ?? AVAIL_DOT.UNKNOWN}`} />
                                ))
                              : null}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setPickerFor(pickerFor === instructor.cohortInstructorId ? null : instructor.cohortInstructorId)
                            }
                            className="text-xs text-violet-700 underline whitespace-nowrap"
                          >
                            {instructor.assignedSessionIds.length
                              ? `${instructor.assignedSessionIds.length} of ${cohort.sessionCount} — edit`
                              : "assign sessions"}
                          </button>
                        </div>
                      </td>
                      <td className="py-2 space-x-2 whitespace-nowrap">
                        <button
                          className="text-xs text-violet-700 underline"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/instructor-response/${instructor.responseToken}`);
                            setMessage(`Copied cohort response link for ${instructor.email}`);
                          }}
                        >
                          Cohort link
                        </button>
                        <button
                          className="text-xs text-sky-700 underline"
                          onClick={() =>
                            startTransition(async () => {
                              const result = await scheduleLinkAction(instructor.instructorId);
                              if (result.ok) {
                                navigator.clipboard.writeText(`${window.location.origin}/instructor-schedule/${result.token}`);
                                setMessage(`Copied full schedule link for ${instructor.email}`);
                              }
                            })
                          }
                        >
                          Schedule link
                        </button>
                      </td>
                    </tr>
                  )).flatMap((row, idx) => {
                    const instructor = cohort.instructors[idx];
                    if (pickerFor !== instructor.cohortInstructorId) return [row];
                    return [
                      row,
                      <tr key={`${instructor.cohortInstructorId}-picker`}>
                        <td colSpan={5} className="pb-3">
                          <SessionPicker
                            cohortId={cohort.cohortId}
                            cohortInstructorId={instructor.cohortInstructorId}
                            instructorId={instructor.instructorId}
                            instructorName={instructor.name ?? instructor.email}
                            sessions={cohort.sessions}
                            assignedSessionIds={instructor.assignedSessionIds}
                            unansweredSessionIds={instructor.unansweredSessionIds}
                            onDone={(msg) => {
                              setMessage(msg);
                              setPickerFor(null);
                            }}
                          />
                        </td>
                      </tr>,
                    ];
                  })}
                  {cohort.instructors.length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-sm text-slate-400">No instructor records — assign instructors, then Sync roster.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
