// src/components/members/MembershipPanel.tsx
//
// Self-contained membership section for Settings: shows the current plan and
// renewal state, opens the Stripe billing portal (card / invoices / cancel),
// and switches tiers via /api/membership/change-tier. State changes land via
// the Stripe webhook, so after a plan change we show "processing" copy rather
// than optimistically flipping the tier.
"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, CreditCard, Loader2, ArrowUpCircle, AlertTriangle } from "lucide-react";
import { content } from "@/config/content";
import { formatMembershipTierPriceLabel } from "@/lib/pricing";

interface MembershipMe {
  isMember: boolean;
  tier: "MENTOR_NETWORK" | "ACCELERATOR" | null;
  tierLabel: string | null;
  status: string;
  inGrace: boolean;
  graceDays: number;
  currentPeriodEnd: string | null;
  hasBilling: boolean;
  canChangePlan: boolean;
}

export function MembershipPanel() {
  const [me, setMe] = useState<MembershipMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [changeLoading, setChangeLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/membership/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const openPortal = async () => {
    setPortalLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/membership/portal", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage({ type: "error", text: data.error || "Failed to open billing portal" });
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setPortalLoading(false);
    }
  };

  const changeTier = async (tier: "MENTOR_NETWORK" | "ACCELERATOR") => {
    const targetTier = content.membershipTiers.find((candidate) => candidate.id === tier);
    if (!targetTier) {
      setMessage({ type: "error", text: "That membership plan is not available." });
      return;
    }
    const label = formatMembershipTierPriceLabel(targetTier);
    if (!window.confirm(`Switch your plan to ${label}? The difference is prorated on your next invoice.`)) return;
    setChangeLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/membership/change-tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: "success",
          text: "Plan change submitted — it will reflect here within a minute.",
        });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to change plan" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setChangeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading membership…
      </div>
    );
  }

  if (!me || !me.isMember) {
    return (
      <div className="text-sm text-slate-500">
        <p>You don&apos;t have an active membership.</p>
        <a
          href="/members"
          className="inline-flex items-center gap-1.5 mt-2 text-primary font-medium hover:underline"
        >
          <BadgeCheck className="h-4 w-4" /> Explore memberships
        </a>
      </div>
    );
  }

  const renewal = me.currentPeriodEnd
    ? new Date(me.currentPeriodEnd).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="space-y-4">
      {me.inGrace && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>
            Your last payment failed. Update your payment method within {me.graceDays} days of your
            renewal date to keep access.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-primary" />
            {me.tierLabel}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Status: {me.status === "past_due" ? "payment issue" : me.status}
            {renewal ? ` · renews ${renewal}` : ""}
          </p>
        </div>
      </div>

      {message && (
        <p
          className={`text-xs ${message.type === "success" ? "text-emerald-600" : "text-red-600"}`}
        >
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {me.hasBilling && (
          <button
            type="button"
            onClick={openPortal}
            disabled={portalLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Manage billing
          </button>
        )}
        {me.canChangePlan && me.tier === "MENTOR_NETWORK" && (
          <button
            type="button"
            onClick={() => changeTier("ACCELERATOR")}
            disabled={changeLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {changeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
            Upgrade to Accelerator
          </button>
        )}
        {me.canChangePlan && me.tier === "ACCELERATOR" && (
          <button
            type="button"
            onClick={() => changeTier("MENTOR_NETWORK")}
            disabled={changeLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {changeLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Switch to Recordings plan
          </button>
        )}
      </div>
    </div>
  );
}
