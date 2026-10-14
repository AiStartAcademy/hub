// src/app/(dashboard)/admin/sales/page.tsx
//
// Every transaction the hub has ever recorded. Reporting only — nothing on this
// page writes to Payment/Membership; the Stripe webhook remains the sole writer.

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DollarSign } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { hasAnyRole } from "@/lib/roles";
import { getAllPurchases, computeSalesTotals } from "@/lib/purchases";
import SalesClient, { type SaleRow } from "./SalesClient";

export const metadata = { title: "Sales | Admin" };

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session?.user, ["ADMIN", "TEAM_MEMBER"])) {
    redirect("/dashboard");
  }

  const purchases = await getAllPurchases();
  const totals = computeSalesTotals(purchases);

  // Dates are serialized at the server/client boundary; the client component
  // formats them and never does money arithmetic.
  const sales: SaleRow[] = purchases.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    tier: p.tier,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    purchasedAt: p.purchasedAt.toISOString(),
    currentPeriodEnd: p.currentPeriodEnd ? p.currentPeriodEnd.toISOString() : null,
    userId: p.userId,
    buyerEmail: p.buyerEmail,
    buyerName: p.buyerName,
    attribution: p.attribution,
    segment: p.segment,
    stripeSessionId: p.stripeSessionId,
    recoveredAt: p.recoveredAt ? p.recoveredAt.toISOString() : null,
    couponCode: p.couponCode,
  }));

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <DollarSign className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Sales</h1>
        <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline-block dark:border-slate-700 dark:bg-slate-800">
          {totals.totalCount} transactions
        </span>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <SalesClient sales={sales} totals={totals} />
        </div>
      </main>
    </div>
  );
}
