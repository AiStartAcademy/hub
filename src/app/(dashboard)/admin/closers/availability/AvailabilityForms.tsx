"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  createAvailabilityAction,
  deleteAvailabilityAction,
  type AvailabilityActionState,
} from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const labelClass =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950"
    >
      {pending ? "Creating…" : "Add availability"}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}

function ActionMessage({ state }: { state: AvailabilityActionState }) {
  if (state.error) {
    return <p className="text-sm text-rose-600 dark:text-rose-400">{state.error}</p>;
  }
  if (state.ok) {
    return <p className="text-sm text-emerald-600 dark:text-emerald-400">{state.ok}</p>;
  }
  return null;
}

export function CreateAvailabilityForm({ closerId }: { closerId: string }) {
  const [state, action] = useActionState<AvailabilityActionState, FormData>(
    createAvailabilityAction,
    {},
  );
  const [repeatWeekly, setRepeatWeekly] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="closerId" value={closerId} />
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className={labelClass} htmlFor="availability-date">
            Date
          </label>
          <input
            id="availability-date"
            name="date"
            type="date"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="availability-start">
            Start time
          </label>
          <input
            id="availability-start"
            name="startTime"
            type="time"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="availability-end">
            End time
          </label>
          <input
            id="availability-end"
            name="endTime"
            type="time"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="availability-timezone">
            Timezone
          </label>
          <input
            id="availability-timezone"
            name="timezone"
            required
            defaultValue="America/Los_Angeles"
            placeholder="America/Los_Angeles"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            name="repeatWeekly"
            type="checkbox"
            checked={repeatWeekly}
            onChange={(event) => setRepeatWeekly(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Repeat weekly
        </label>
        <div className="w-36">
          <label className={labelClass} htmlFor="availability-weeks">
            Weeks in series
          </label>
          <input
            id="availability-weeks"
            name="weeks"
            type="number"
            min={2}
            max={52}
            defaultValue={4}
            required={repeatWeekly}
            disabled={!repeatWeekly}
            className={inputClass}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CreateButton />
          <ActionMessage state={state} />
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        A weekly series includes the selected date and creates the same local-time window for
        each week in the series.
      </p>
    </form>
  );
}

export function DeleteAvailabilityForm({
  closerId,
  slotId,
}: {
  closerId: string;
  slotId: string;
}) {
  const [state, action] = useActionState<AvailabilityActionState, FormData>(
    deleteAvailabilityAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="closerId" value={closerId} />
      <input type="hidden" name="slotId" value={slotId} />
      <DeleteButton />
      <ActionMessage state={state} />
    </form>
  );
}
