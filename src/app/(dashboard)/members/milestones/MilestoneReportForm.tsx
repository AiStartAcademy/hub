"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  initialReportMilestoneActionState,
  reportMilestoneAction,
  type ReportMilestoneActionState,
} from "./actions";

type MilestoneReportFormProps = {
  milestoneKey: string;
  evidenceUrl?: string;
  note?: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
    >
      {pending ? "Submitting..." : "Submit milestone"}
    </button>
  );
}

function Message({ state }: { state: ReportMilestoneActionState }) {
  if (!state.message) return null;

  return (
    <p
      className={
        state.status === "error"
          ? "text-sm text-rose-600 dark:text-rose-400"
          : "text-sm text-emerald-600 dark:text-emerald-400"
      }
    >
      {state.message}
    </p>
  );
}

export function MilestoneReportForm({
  milestoneKey,
  evidenceUrl,
  note,
}: MilestoneReportFormProps) {
  const [state, formAction] = useActionState(
    reportMilestoneAction,
    initialReportMilestoneActionState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <input type="hidden" name="milestoneKey" value={milestoneKey} />

      <div className="space-y-1">
        <label
          htmlFor={`${milestoneKey}-evidence`}
          className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
        >
          Evidence link
        </label>
        <input
          id={`${milestoneKey}-evidence`}
          name="evidenceUrl"
          type="url"
          inputMode="url"
          defaultValue={evidenceUrl}
          placeholder="https://..."
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
        />
      </div>

      <div className="space-y-1">
        <label
          htmlFor={`${milestoneKey}-note`}
          className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
        >
          Note
        </label>
        <textarea
          id={`${milestoneKey}-note`}
          name="note"
          rows={3}
          maxLength={500}
          defaultValue={note}
          placeholder="Add a short note for the review team."
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-slate-500"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Leave both fields blank only if you want to re-submit without new context.
        </p>
        <SubmitButton />
      </div>

      <Message state={state} />
    </form>
  );
}
