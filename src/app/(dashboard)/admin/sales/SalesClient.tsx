"use client";

// src/app/(dashboard)/admin/sales/SalesClient.tsx
//
// Renders the sales table. Presentation only — no mutations, no fetches. All
// money arithmetic happened server-side in computeSalesTotals(); this component
// formats what it was given.

import { useMemo, useState } from "react";
import { Search, Download, TrendingUp, RotateCcw, Clock, Wallet, Undo2 } from "lucide-react";
import { formatAmount, type PurchaseKind, type PurchaseStatus, type SalesTotals } from "@/lib/purchases";
import { buildSalesExportFilename } from "@/lib/salesExport";

export type SaleRow = {
  id: string;
  kind: PurchaseKind;
  title: string;
  tier: string | null;
  status: PurchaseStatus;
  amount: number;
  currency: string;
  purchasedAt: string;
  currentPeriodEnd: string | null;
  userId: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  attribution: Record<string, string>;
  segment: string | null;
  stripeSessionId: string | null;
  /** Set when this sale came back from an abandoned cart. */
  recoveredAt: string | null;
  couponCode: string | null;
};

const STATUS_STYLES: Record<PurchaseStatus, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  past_due: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  refunded: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20",
  canceled: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20",
  failed: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "collected", label: "Collected" },
  { value: "pending", label: "Pending" },
  { value: "refunded", label: "Refunded" },
  { value: "failed", label: "Incomplete" },
  { value: "recovered", label: "Recovered" },
];

const KIND_FILTERS: Array<{ value: "all" | PurchaseKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "COHORT", label: "Cohort" },
  { value: "MEMBERSHIP", label: "Membership" },
  { value: "VENUE_RENTAL", label: "Venue" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The marketing source that produced this sale, if any was captured at
 *  checkout. utm_source is the headline; the rest shows on hover. */
function sourceLabel(row: SaleRow): string {
  const a = row.attribution ?? {};
  const source = a.utm_source ?? a.source ?? null;
  const medium = a.utm_medium ?? null;
  if (source && medium) return `${source} / ${medium}`;
  if (source) return source;
  if (a.gclid) return "google ads";
  if (a.fbclid) return "meta ads";
  return "—";
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent}`} />
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function toCsv(rows: SaleRow[]): string {
  const header = [
    "date", "kind", "item", "tier", "status", "amount_cents", "currency",
    "buyer_name", "buyer_email", "segment", "utm_source", "utm_medium",
    "utm_campaign", "stripe_session_id", "coupon_code", "recovered_at",
  ];
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.purchasedAt, r.kind, r.title, r.tier, r.status, r.amount, r.currency,
      r.buyerName, r.buyerEmail, r.segment,
      r.attribution?.utm_source ?? null,
      r.attribution?.utm_medium ?? null,
      r.attribution?.utm_campaign ?? null,
      r.stripeSessionId,
      r.couponCode,
      r.recoveredAt,
    ].map(escape).join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function SalesClient({ sales, totals }: { sales: SaleRow[]; totals: SalesTotals }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | PurchaseKind>("all");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sales.filter((row) => {
      if (kind !== "all" && row.kind !== kind) return false;
      if (status === "collected" && !(row.status === "paid" || row.status === "active")) return false;
      if (status === "pending" && row.status !== "pending") return false;
      if (status === "refunded" && row.status !== "refunded") return false;
      if (status === "failed" && !(row.status === "failed" || row.status === "canceled" || row.status === "past_due")) return false;
      if (status === "recovered" && !row.recoveredAt) return false;
      if (!q) return true;
      return (
        (row.buyerEmail ?? "").toLowerCase().includes(q) ||
        (row.buyerName ?? "").toLowerCase().includes(q) ||
        row.title.toLowerCase().includes(q) ||
        (row.tier ?? "").toLowerCase().includes(q)
      );
    });
  }, [sales, query, kind, status]);

  function downloadCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildSalesExportFilename(new Date());
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Collected, refunded and pending are shown as three separate figures on
          purpose — folding them into one "revenue" number would overstate it. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={TrendingUp} accent="text-emerald-500" label="Collected"
          value={formatAmount(totals.collectedCents)}
          sub={`${totals.collectedCount} completed`}
        />
        <StatCard
          icon={RotateCcw} accent="text-slate-400" label="Refunded"
          value={formatAmount(totals.refundedCents)}
          sub={`${totals.refundedCount} refunded`}
        />
        <StatCard
          icon={Wallet} accent="text-primary" label="Net"
          value={formatAmount(totals.netCents)}
          sub="collected − refunded"
        />
        <StatCard
          icon={Clock} accent="text-amber-500" label="Pending"
          value={formatAmount(totals.pendingCents)}
          sub={`${totals.pendingCount} unpaid carts`}
        />
        {/* Recovered is a slice of Collected, not a fifth pot of money — the
            sub-label says so, because a reader who adds these five figures
            together should not arrive at a number we would ever quote. */}
        <StatCard
          icon={Undo2} accent="text-teal-500" label="Recovered"
          value={formatAmount(totals.recoveredCents)}
          sub={`${totals.recoveredCount} of collected`}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search buyer, email, item or tier…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Kind
            </span>
            {KIND_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setKind(f.value)}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                  kind === f.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-slate-200 bg-white text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              Status
            </span>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                  status === f.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-slate-200 bg-white text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={filtered.length === 0}
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-500 shadow-sm transition-colors hover:text-primary disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-bold uppercase tracking-widest text-slate-400">
            {sales.length === 0 ? "No sales yet" : "No matching transactions"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {sales.length === 0
              ? "Completed Stripe checkouts will appear here."
              : "Try a different search or status filter."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800">
              <tr className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filtered.map((row) => (
                <tr key={`${row.kind}-${row.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {formatDate(row.purchasedAt)}
                  </td>
                  <td className="px-4 py-3">
                    {/* buyerEmail is the fallback identity: guest checkouts and
                        rows orphaned by user deletion have no userId. */}
                    <p className="font-medium text-slate-900 dark:text-white">
                      {row.buyerName ?? row.buyerEmail ?? "Unknown buyer"}
                    </p>
                    {row.buyerName && row.buyerEmail && (
                      <p className="text-xs text-slate-500">{row.buyerEmail}</p>
                    )}
                    {!row.userId && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        no account
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-900 dark:text-white">{row.title}</p>
                    <p className="text-xs text-slate-500">
                      {row.kind === "MEMBERSHIP"
                        ? row.tier || "Subscription"
                        : row.kind === "VENUE_RENTAL"
                          ? "Venue rental"
                          : row.tier ?? "Seat"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500" title={JSON.stringify(row.attribution)}>
                    {sourceLabel(row)}
                    {row.segment && (
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">{row.segment}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[row.status]}`}>
                      {row.status === "failed" ? "incomplete" : row.status.replace("_", " ")}
                    </span>
                    {row.recoveredAt && (
                      <span
                        title={`Abandoned cart recovered ${formatDate(row.recoveredAt)}`}
                        className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-teal-600 dark:text-teal-400"
                      >
                        <Undo2 className="h-3 w-3" />
                        recovered
                      </span>
                    )}
                    {row.couponCode && (
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                        {row.couponCode}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatAmount(row.amount, row.currency)}
                    {row.kind === "MEMBERSHIP" && (
                      <span className="text-xs font-medium text-slate-400">/mo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
