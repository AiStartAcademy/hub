// src/app/(dashboard)/purchases/page.tsx
//
// A student's own receipts. Read-only: the Stripe webhook owns every row shown here.

import { redirect } from "next/navigation";
import { Receipt, CreditCard, CalendarDays } from "lucide-react";
import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import {
  getUserPurchases,
  formatAmount,
  type Purchase,
  type PurchaseStatus,
} from "@/lib/purchases";

export const metadata = { title: "Purchases" };

// Server-rendered from the session on every request — a receipt must never be
// served from a cache keyed on anything but the signed-in user.
export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<PurchaseStatus, { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" },
  active: { label: "Active", className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" },
  pending: { label: "Pending", className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" },
  past_due: { label: "Past due", className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" },
  refunded: { label: "Refunded", className: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20" },
  canceled: { label: "Canceled", className: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20" },
  failed: { label: "Incomplete", className: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20" },
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status }: { status: PurchaseStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}

function PurchaseRow({ purchase }: { purchase: Purchase }) {
  return (
    <li className="flex flex-col gap-3 p-4 md:p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
          {purchase.kind === "MEMBERSHIP" ? (
            <CreditCard className="h-4 w-4 text-slate-500" />
          ) : (
            <Receipt className="h-4 w-4 text-slate-500" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{purchase.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {purchase.tier ? `${purchase.tier} · ` : ""}
            {formatDate(purchase.purchasedAt)}
            {purchase.kind === "MEMBERSHIP" && purchase.currentPeriodEnd
              ? ` · renews ${formatDate(purchase.currentPeriodEnd)}`
              : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-3 pl-12 sm:pl-0">
        <StatusBadge status={purchase.status} />
        <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
          {formatAmount(purchase.amount, purchase.currency)}
          {purchase.kind === "MEMBERSHIP" && (
            <span className="text-xs font-medium text-slate-400">/mo</span>
          )}
        </span>
      </div>
    </li>
  );
}

export default async function PurchasesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Identity comes off the session and nowhere else. There is deliberately no
  // userId/email query param on this route — see ISC-14 in the feature ISA.
  const purchases = await getUserPurchases(session.user.id, session.user.email);

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Receipt className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Purchases</h1>
        {purchases.length > 0 && (
          <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline-block dark:border-slate-700 dark:bg-slate-800">
            {purchases.length} {purchases.length === 1 ? "record" : "records"}
          </span>
        )}
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-4xl">
          {purchases.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <CalendarDays className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-bold uppercase tracking-widest text-slate-400">No purchases yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Cohort seats and memberships you buy will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {purchases.map((p) => (
                <PurchaseRow key={`${p.kind}-${p.id}`} purchase={p} />
              ))}
            </ul>
          )}

          <p className="mt-4 px-1 text-xs text-slate-400">
            Questions about a charge? Email{" "}
            <a href={`mailto:${brand.email.contact}`} className="font-medium text-primary hover:underline">
              {brand.email.contact}
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
