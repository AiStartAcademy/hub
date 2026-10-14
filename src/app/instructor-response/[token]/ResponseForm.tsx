"use client";

import { useState, useTransition } from "react";
import { submitInstructorResponse } from "@/app/actions/instructorResponse";

type SessionRow = {
  id: string;
  title: string;
  date: string;
  time: string;
  availability: string;
  note: string;
};

const AVAILABILITY_OPTIONS = [
  { value: "AVAILABLE", label: "Available", active: "bg-emerald-600 text-white border-emerald-600" },
  { value: "TENTATIVE", label: "Tentative", active: "bg-amber-500 text-white border-amber-500" },
  { value: "UNAVAILABLE", label: "Unavailable", active: "bg-rose-600 text-white border-rose-600" },
];

export default function ResponseForm({
  token,
  initialStatus,
  initialNotes,
  respondedAt,
  sessions,
}: {
  token: string;
  initialStatus: string;
  initialNotes: string;
  respondedAt: string | null;
  sessions: SessionRow[];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(initialNotes);
  const [rows, setRows] = useState(sessions);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setAvailability = (id: string, availability: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, availability } : r)));
  const setNote = (id: string, note: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, note } : r)));

  const submit = (nextStatus: "CONFIRMED" | "DECLINED") => {
    setStatus(nextStatus);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await submitInstructorResponse({
        token,
        status: nextStatus,
        notes,
        sessionResponses: rows.map((r) => ({
          sessionId: r.id,
          availability: r.availability,
          note: r.note,
        })),
      });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  };

  return (
    <div className="mt-8">
      {respondedAt && (
        <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-xs text-slate-500">
          Last response: {new Date(respondedAt).toLocaleString()} — current status{" "}
          <strong>{initialStatus}</strong>. Submitting again updates it.
        </p>
      )}

      {sessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Session availability
          </h2>
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{row.title}</p>
                  <p className="text-xs text-slate-500">
                    {row.date} · {row.time}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {AVAILABILITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAvailability(row.id, opt.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                        row.availability === opt.value
                          ? opt.active
                          : "border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {row.availability !== "AVAILABLE" && row.availability !== "UNKNOWN" && (
                <input
                  type="text"
                  value={row.note}
                  onChange={(e) => setNote(row.id, e.target.value)}
                  placeholder="Optional note (e.g. can start 30 min late)"
                  className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <label className="text-sm font-bold uppercase tracking-wide text-slate-500">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything we should know — travel, constraints, topics you'd rather swap…"
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("CONFIRMED")}
          className="inline-flex items-center rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm participation"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("DECLINED")}
          className="inline-flex items-center rounded-lg border border-rose-300 px-5 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          I can&apos;t teach this cohort
        </button>
      </div>

      {saved && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
          Saved — thank you! Status: {status}.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
