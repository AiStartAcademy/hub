"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createCouponAction, type CouponActionState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const labelClass =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950"
    >
      {pending ? "Creating in Stripe…" : "Create code"}
    </button>
  );
}

export function CouponForm({
  cohorts,
}: {
  cohorts: { id: string; title: string }[];
}) {
  const [state, action] = useActionState<CouponActionState, FormData>(
    createCouponAction,
    {}
  );
  const [appliesTo, setAppliesTo] = useState("all");
  const [discountType, setDiscountType] = useState("percent");

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="code">
            Code
          </label>
          <input
            id="code"
            name="code"
            required
            placeholder="COMEBACK10"
            className={`${inputClass} uppercase`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="kind">
            Kind
          </label>
          <select id="kind" name="kind" className={inputClass} defaultValue="MANUAL">
            <option value="MANUAL">Manual — one-off discount</option>
            <option value="CAMPAIGN">Campaign — ads, QR, email</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="discountValue">
            Discount
          </label>
          <div className="flex gap-2">
            <select
              name="discountType"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value)}
              className={`${inputClass} w-28`}
            >
              <option value="percent">%</option>
              <option value="amount">$</option>
            </select>
            <input
              id="discountValue"
              name="discountValue"
              type="number"
              min={1}
              required
              placeholder={discountType === "percent" ? "10" : "50"}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label className={labelClass} htmlFor="appliesTo">
            Applies to
          </label>
          <select
            id="appliesTo"
            name="appliesTo"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value)}
            className={inputClass}
          >
            <option value="all">Everything</option>
            <option value="cohort">Cohorts only</option>
            <option value="membership">Membership only</option>
            <option value="program">Programs only</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="cohortId">
            Cohort (optional)
          </label>
          <select
            id="cohortId"
            name="cohortId"
            className={inputClass}
            disabled={appliesTo !== "cohort"}
            defaultValue=""
          >
            <option value="">Any cohort</option>
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="maxRedemptions">
            Max uses
          </label>
          <input
            id="maxRedemptions"
            name="maxRedemptions"
            type="number"
            min={1}
            placeholder="unlimited"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="expiresAt">
            Expires
          </label>
          <input id="expiresAt" name="expiresAt" type="date" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="note">
          Note (internal)
        </label>
        <input
          id="note"
          name="note"
          placeholder="Why this code exists — who asked, which poster, which campaign"
          className={inputClass}
        />
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state.error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">{state.error}</p>
        ) : null}
        {state.ok ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">{state.ok}</p>
        ) : null}
      </div>
    </form>
  );
}
