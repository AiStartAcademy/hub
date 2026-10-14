"use client";

import { useMemo, useState, useTransition } from "react";
import { brand } from "@/config/brand";
import { MONTHS, DAYS, getCalendarMonthGrid } from "@/lib/calendarUtils";
import { submitScheduleResponse, acceptAllForCohort } from "@/app/actions/instructorSchedule";
import type { InstructorScheduleView, ScheduleSession } from "@/lib/instructorSchedule";

const STATUS_STYLE: Record<string, { badge: string; dot: string; label: string }> = {
  PROPOSED: { badge: "bg-amber-100 text-amber-800", dot: "bg-amber-400", label: "Awaiting you" },
  ACCEPTED: { badge: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-400", label: "Accepted" },
  CONFIRMED: { badge: "bg-emerald-600 text-white", dot: "bg-emerald-600", label: "Confirmed" },
  CHANGE_REQUESTED: { badge: "bg-sky-100 text-sky-800", dot: "bg-sky-400", label: "Change requested" },
  COUNTERED: { badge: "bg-violet-100 text-violet-800", dot: "bg-violet-400", label: "New time proposed" },
  DECLINED: { badge: "bg-rose-100 text-rose-700", dot: "bg-rose-400", label: "Declined" },
  UNASSIGNED: { badge: "bg-slate-100 text-slate-600", dot: "bg-slate-300", label: "Not yet proposed" },
};

function fmtTime(iso: string | null, tz: string): string {
  if (!iso) return "time TBD";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(iso));
}

function fmtDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function ScheduleClient({
  token,
  view,
}: {
  token: string;
  view: InstructorScheduleView;
}) {
  const [sessions, setSessions] = useState(view.sessions);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const firstDate = sessions.find((s) => s.dateKey)?.dateKey;
  const [cursor, setCursor] = useState(() => {
    if (!firstDate) return new Date();
    const [y, m] = firstDate.split("-").map(Number);
    return new Date(y, m - 1, 1);
  });

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleSession[]>();
    for (const s of sessions) {
      if (!s.dateKey) continue;
      const list = map.get(s.dateKey) ?? [];
      list.push(s);
      map.set(s.dateKey, list);
    }
    return map;
  }, [sessions]);

  const grid = getCalendarMonthGrid(cursor);
  const monthKey = (day: number) =>
    `${grid.year}-${String(grid.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const applyLocal = (assignmentId: string, status: string) =>
    setSessions((prev) =>
      prev.map((s) => (s.assignmentId === assignmentId ? { ...s, status: status as ScheduleSession["status"] } : s))
    );

  const respond = (
    session: ScheduleSession,
    action: "accept" | "request_change" | "decline",
    extra: { note?: string; proposedDate?: string; proposedStartTime?: string; proposedEndTime?: string } = {}
  ) => {
    if (!session.assignmentId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await submitScheduleResponse({
        token,
        assignmentId: session.assignmentId!,
        action,
        ...extra,
      });
      if (result.ok) {
        applyLocal(session.assignmentId!, result.status);
        setOpenForm(null);
        setMessage(
          action === "accept"
            ? `Thanks — ${session.title} is accepted.`
            : action === "decline"
              ? `Noted, we'll cover ${session.title} another way.`
              : `Sent — we'll get back to you about ${session.title}.`
        );
      } else {
        setMessage(result.error);
      }
    });
  };

  const confirmCohort = (cohortId: string, title: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await acceptAllForCohort(token, cohortId);
      if (result.ok) {
        setSessions((prev) =>
          prev.map((s) =>
            s.cohortId === cohortId && (s.status === "PROPOSED" || s.status === "COUNTERED")
              ? { ...s, status: "ACCEPTED" }
              : s
          )
        );
        setMessage(`Accepted ${result.accepted} session(s) for ${title}.`);
      } else setMessage(result.error);
    });
  };

  const pendingCount = sessions.filter((s) => s.status === "PROPOSED" || s.status === "COUNTERED").length;
  const dayKeys = [...byDate.keys()].sort();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-4xl">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
          {brand.wordmark}
        </p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">
          {view.instructor.name?.split(" ")[0] ?? "Your"} teaching schedule
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {pendingCount
            ? `${pendingCount} session${pendingCount === 1 ? "" : "s"} need your answer.`
            : "Everything here has an answer — thank you."}{" "}
          Approve what works, or ask for a different time. You can come back to this link any time.
        </p>

        {message && (
          <p className="mt-4 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white">{message}</p>
        )}

        {view.fullDayOpportunities.length > 0 && (
          <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-4">
            <h2 className="text-sm font-bold text-violet-900">Could you take the full day?</h2>
            <ul className="mt-2 space-y-1 text-sm text-violet-800">
              {view.fullDayOpportunities.slice(0, 5).map((o) => (
                <li key={`${o.dateKey}-${o.otherSessionId}`}>
                  {fmtDayLabel(o.dateKey)} — you&apos;re on {o.bookedCohortTitle}; {o.otherCohortTitle} also runs
                  that {o.missingHalf} ({o.otherSessionTitle}).
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-violet-700">
              Reply to the email if you&apos;d like to teach both — we&apos;d rather book you for the whole day.
            </p>
          </div>
        )}

        {/* Month grid */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCursor(new Date(grid.year, grid.month - 1, 1))}
              className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              ←
            </button>
            <p className="text-sm font-bold text-slate-900">
              {MONTHS[grid.month]} {grid.year}
            </p>
            <button
              type="button"
              onClick={() => setCursor(new Date(grid.year, grid.month + 1, 1))}
              className="rounded-lg border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              →
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {DAYS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {grid.days.map((day, i) => {
              const inMonth = day > 0;
              const key = inMonth ? monthKey(day) : `pad-${i}`;
              const daySessions = inMonth ? byDate.get(key) ?? [] : [];
              return (
                <div
                  key={key}
                  className={`min-h-[58px] rounded-lg border p-1 text-left ${
                    inMonth ? "border-slate-100" : "border-transparent bg-slate-50/50"
                  }`}
                >
                  {inMonth && <span className="text-[11px] text-slate-400">{day}</span>}
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {daySessions.map((s) => (
                      <span
                        key={s.sessionId}
                        title={`${s.cohortTitle} — ${s.title}`}
                        className={`h-2 w-2 rounded-full ${STATUS_STYLE[s.status]?.dot ?? "bg-slate-300"}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-cohort accept-all */}
        <div className="mt-6 flex flex-wrap gap-2">
          {view.cohorts.map((c) => (
            <button
              key={c.cohortId}
              type="button"
              disabled={pending}
              onClick={() => confirmCohort(c.cohortId, c.title)}
              className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Accept all — {c.title}
            </button>
          ))}
        </div>

        {/* Agenda */}
        <div className="mt-6 space-y-5">
          {dayKeys.map((dateKey) => (
            <div key={dateKey}>
              <h2 className="text-sm font-bold text-slate-900">{fmtDayLabel(dateKey)}</h2>
              <div className="mt-2 space-y-2">
                {byDate
                  .get(dateKey)!
                  .sort((a, b) => (a.startUtc ?? "").localeCompare(b.startUtc ?? ""))
                  .map((session) => {
                    const style = STATUS_STYLE[session.status] ?? STATUS_STYLE.UNASSIGNED;
                    const answered = session.status !== "PROPOSED" && session.status !== "COUNTERED";
                    return (
                      <div key={session.sessionId} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{session.title}</p>
                            <p className="text-xs text-slate-500">
                              {session.cohortTitle} · {fmtTime(session.startUtc, session.timezone)}–
                              {fmtTime(session.endUtc, session.timezone)}
                              {session.isEvening ? " · evening" : ""}
                            </p>
                            {session.conflictsWith.length > 0 && (
                              <p className="mt-1 text-xs font-semibold text-rose-600">
                                ⚠ Overlaps another session you&apos;re booked for
                              </p>
                            )}
                            {session.adminNote && (
                              <p className="mt-1 text-xs italic text-violet-700">{brand.shortName}: “{session.adminNote}”</p>
                            )}
                            {session.note && (
                              <p className="mt-1 text-xs italic text-slate-500">You: “{session.note}”</p>
                            )}
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${style.badge}`}>
                            {style.label}
                          </span>
                        </div>

                        {session.assignmentId && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => respond(session, "accept")}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                            >
                              {answered ? "Keep / re-accept" : "Approve"}
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => setOpenForm(openForm === session.sessionId ? null : session.sessionId)}
                              className="rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                            >
                              Request a different time
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => respond(session, "decline")}
                              className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            >
                              Can&apos;t make it
                            </button>
                          </div>
                        )}

                        {openForm === session.sessionId && (
                          <ChangeRequestForm
                            pending={pending}
                            onSubmit={(payload) => respond(session, "request_change", payload)}
                          />
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          {dayKeys.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing scheduled yet — we&apos;ll email you when the next cohort dates are set.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function ChangeRequestForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (payload: {
    note?: string;
    proposedDate?: string;
    proposedStartTime?: string;
    proposedEndTime?: string;
  }) => void;
}) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");

  // The stored format is 12-hour wall clock ("6:00 PM"); <input type="time"> gives 24h.
  const to12h = (value: string) => {
    if (!value) return undefined;
    const [h, m] = value.split(":").map(Number);
    const meridiem = h >= 12 ? "PM" : "AM";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, "0")} ${meridiem}`;
  };

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Propose an alternative</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why, or what would work better"
        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onSubmit({
            note,
            proposedDate: date || undefined,
            proposedStartTime: to12h(start),
            proposedEndTime: to12h(end),
          })
        }
        className="mt-2 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
      >
        Send request
      </button>
    </div>
  );
}
