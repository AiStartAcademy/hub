"use client";
// src/components/MembershipPlans.tsx
// Membership tier cards + Stripe checkout. Used by the /membership landing page
// and by the teaser on the public cohorts list. Checkout posts to the existing
// POST /api/membership/checkout — guests are allowed through, Stripe collects
// their email, and the verified webhook remains the only path that grants access.
import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import {
  MEMBERSHIP_TIER_CONFIG,
  MEMBERSHIP_TIERS,
  type MembershipTier,
} from "@/lib/membershipTiers";

export const fmtMembershipPrice = (amountCents: number) =>
  `$${(amountCents / 100).toLocaleString("en-US")}`;

/** Shared checkout starter — returns an error string, or null when redirecting. */
export function useMembershipCheckout(tier: MembershipTier) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tierConfig = MEMBERSHIP_TIER_CONFIG[tier];

  async function subscribe() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/membership/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        trackEvent("begin_checkout", {
          conversion_kind: "membership",
          value: tierConfig.amountCents / 100,
          currency: "USD",
          item_name: tierConfig.productName,
        });
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Could not start checkout. Please try again.");
    } catch {
      setError("Could not start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return { subscribe, loading, error };
}

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="mt-1 h-4 w-4 flex-none text-primary-active dark:text-primary"
    >
      <path
        fill="currentColor"
        d="M7.6 13.9 4.1 10.4a1 1 0 0 1 1.4-1.4l2.1 2.1 6.9-6.9a1 1 0 1 1 1.4 1.4l-7.6 7.6a1 1 0 0 1-1.4 0Z"
      />
    </svg>
  );
}

export function MembershipPlanCard({
  tier,
  highlight,
}: {
  tier: MembershipTier;
  highlight?: boolean;
}) {
  const { subscribe, loading, error } = useMembershipCheckout(tier);
  const t = MEMBERSHIP_TIER_CONFIG[tier];
  const buildsOn =
    "buildsOn" in t
      ? MEMBERSHIP_TIER_CONFIG[t.buildsOn as MembershipTier]
      : null;

  return (
    <div
      className={[
        "relative flex flex-col rounded-2xl border p-7 md:p-8",
        highlight
          ? "border-transparent bg-white shadow-xl shadow-slate-900/10 ring-2 ring-accent dark:bg-card-dark dark:shadow-black/40"
          : "border-border bg-white shadow-sm dark:border-border-dark dark:bg-card-dark",
      ].join(" ")}
    >
      {highlight && (
        <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
          For bootcamp graduates
        </span>
      )}

      <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white md:text-2xl">
        {t.cardTitle}
      </h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {t.tagline}
      </p>

      <div className="mt-5 flex items-baseline gap-2">
        <span className="text-4xl font-black tracking-tight text-slate-900 dark:text-white">
          {fmtMembershipPrice(t.amountCents)}
        </span>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          / month
        </span>
      </div>

      <button
        onClick={subscribe}
        disabled={loading}
        data-track="subscribe_membership"
        className={[
          "mt-6 min-h-[48px] w-full rounded-full px-6 font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
          highlight
            ? "bg-accent text-white hover:bg-accent-deep focus-visible:ring-accent"
            : "bg-slate-900 text-white hover:bg-slate-700 focus-visible:ring-slate-900 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200",
        ].join(" ")}
      >
        {loading ? "Starting…" : "Join now →"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
        Cancel anytime · Terms &amp; conditions apply.
      </p>

      <div className="mt-7 border-t border-border pt-6 dark:border-border-dark">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {buildsOn ? `Everything in ${buildsOn.cardTitle}, plus:` : "Includes"}
        </p>
        <ul className="mt-4 space-y-3">
          {t.features.map((f) => (
            <li
              key={f}
              className="flex gap-3 text-sm text-slate-700 dark:text-slate-200"
            >
              <Check />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-slate-700 dark:text-slate-300">
          Best for:
        </span>{" "}
        {t.bestFor}
      </p>
    </div>
  );
}

export function MembershipPlans() {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-8">
      {MEMBERSHIP_TIERS.map((tier) => (
        <MembershipPlanCard
          key={tier}
          tier={tier}
          highlight={tier === "ACCELERATOR"}
        />
      ))}
    </div>
  );
}
