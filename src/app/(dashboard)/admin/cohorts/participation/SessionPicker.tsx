"use client";

// Which sessions does this person actually teach?
//
// Real rosters are sparse — an instructor or guest speaker usually covers 1–2
// sessions of a 10–12 session cohort. This picker is how that gets recorded,
// and it's what keeps the invitation email honest: people are only asked to
// confirm the days they were actually assigned.

import { useState, useTransition } from "react";
import { proposeScheduleAction, unassignSessionAction } from "./actions";

export type PickerSession = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
};

export default function SessionPicker({
  cohortId,
  cohortInstructorId,
  instructorId,
  instructorName,
  sessions,
  assignedSessionIds,
  unansweredSessionIds,
  onDone,
}: {
  cohortId: string;
  cohortInstructorId: string;
  instructorId: string;
  instructorName: string;
  sessions: PickerSession[];
  assignedSessionIds: string[];
  unansweredSessionIds: string[];
  onDone: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedSessionIds));
  const [pending, startTransition] = useTransition();

  const assigned = new Set(assignedSessionIds);
  const unanswered = new Set(unansweredSessionIds);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    // Diff against what's already stored: add the newly ticked, remove the
    // newly unticked. Untouched assignments are left alone so nobody's answer
    // is reset by an unrelated edit.
    const toAdd = [...selected].filter((id) => !assigned.has(id));
    const toRemove = [...assigned].filter((id) => !selected.has(id));

    if (!toAdd.length && !toRemove.length) {
      onDone("No changes.");
      return;
    }

    startTransition(async () => {
      const notes: string[] = [];
      if (toAdd.length) {
        const res = await proposeScheduleAction(cohortId, [instructorId], toAdd);
        notes.push(res.ok ? `assigned ${toAdd.length}` : `assign failed: ${res.error}`);
      }
      for (const sessionId of toRemove) {
        const res = await unassignSessionAction(cohortInstructorId, sessionId);
        if (!res.ok) notes.push(`could not remove one: ${res.error}`);
      }
      const removed = toRemove.filter((id) => unanswered.has(id)).length;
      if (removed) notes.push(`removed ${removed}`);
      onDone(`${instructorName}: ${notes.join(" · ")}`);
    });
  };

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
        Sessions {instructorName} teaches
      </p>

      <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
        {sessions.map((s) => {
          const isAssigned = assigned.has(s.id);
          const locked = isAssigned && !unanswered.has(s.id);
          return (
            <label
              key={s.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                locked ? "opacity-60" : "hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              }`}
              title={locked ? "Already answered by the instructor — decline or clear it instead" : undefined}
            >
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                disabled={locked || pending}
                onChange={() => toggle(s.id)}
                className="h-4 w-4"
              />
              <span className="flex-1">
                <span className="font-medium text-slate-900 dark:text-white">{s.title}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {fmt(s.date)} · {s.startTime}–{s.endTime} {s.timezone}
                </span>
              </span>
              {locked && <span className="text-[10px] font-bold uppercase text-slate-400">answered</span>}
            </label>
          );
        })}
        {!sessions.length && (
          <p className="text-sm text-slate-400">This cohort has no sessions yet.</p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save assignment"}
        </button>
        <span className="text-xs text-slate-500">
          {selected.size} of {sessions.length} selected
        </span>
      </div>
    </div>
  );
}
