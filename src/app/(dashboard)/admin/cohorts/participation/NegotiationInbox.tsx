"use client";

// Everything an instructor has pushed back on, waiting on a decision from us.
// Accepting moves the real session (and ripples to everyone already invited);
// countering keeps the session and sends the ask back with a note.

import { useState, useTransition } from "react";
import { acceptChangeAction, counterChangeAction } from "./actions";

export type ChangeRequestRow = {
  assignmentId: string;
  instructor: string;
  email: string;
  cohortId: string;
  cohortTitle: string;
  sessionId: string;
  sessionTitle: string;
  currentDate: string;
  currentTime: string;
  proposedDate: string | null;
  proposedTime: string | null;
  note: string | null;
  respondedAt: string | null;
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";

export default function NegotiationInbox({ requests }: { requests: ChangeRequestRow[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterNote, setCounterNote] = useState("");
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const open = requests.filter((r) => !resolved.has(r.assignmentId));
  if (!open.length && !message) return null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, id: string, label: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setResolved((prev) => new Set(prev).add(id));
        setCounterFor(null);
        setCounterNote("");
        setMessage(`${label} — done.`);
      } else setMessage(result.error ?? "Failed");
    });
  };

  return (
    <div className="mx-auto max-w-5xl p-6 pb-0">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 dark:border-sky-900 dark:bg-sky-950/30">
        <h2 className="text-sm font-bold uppercase tracking-wide text-sky-900 dark:text-sky-200">
          Schedule change requests ({open.length})
        </h2>
        {message && <p className="mt-2 text-sm font-medium text-sky-900 dark:text-sky-200">{message}</p>}
        <div className="mt-3 space-y-3">
          {open.map((r) => (
            <div key={r.assignmentId} className="rounded-lg border border-sky-200 bg-white p-4 dark:border-sky-900 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {r.instructor} · {r.cohortTitle} — {r.sessionTitle}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Currently {fmtDate(r.currentDate)} · {r.currentTime}
                {r.proposedDate || r.proposedTime ? (
                  <>
                    {" → asking for "}
                    <strong className="text-sky-700 dark:text-sky-300">
                      {r.proposedDate ? fmtDate(r.proposedDate) : "same date"}
                      {r.proposedTime ? ` · ${r.proposedTime}` : ""}
                    </strong>
                  </>
                ) : (
                  " → no specific alternative given"
                )}
              </p>
              {r.note && <p className="mt-1 text-xs italic text-slate-600 dark:text-slate-300">“{r.note}”</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending || (!r.proposedDate && !r.proposedTime)}
                  title={!r.proposedDate && !r.proposedTime ? "No alternative to accept — counter instead" : undefined}
                  onClick={() => run(() => acceptChangeAction(r.assignmentId), r.assignmentId, "Session moved and confirmed")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
                >
                  Accept & move session
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCounterFor(counterFor === r.assignmentId ? null : r.assignmentId)}
                  className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                >
                  Counter
                </button>
                <a
                  href={`mailto:${r.email}`}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Email {r.email}
                </a>
              </div>

              {counterFor === r.assignmentId && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                  <input
                    type="text"
                    value={counterNote}
                    onChange={(e) => setCounterNote(e.target.value)}
                    placeholder="What you can offer instead — they'll see this on their schedule page"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    disabled={pending || !counterNote.trim()}
                    onClick={() =>
                      run(() => counterChangeAction(r.assignmentId, counterNote), r.assignmentId, "Counter sent")
                    }
                    className="mt-2 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Send counter
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
