import { WalletCards } from "lucide-react";
import { redirect } from "next/navigation";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { AI_FEATURES } from "@/lib/ai/features";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/roles";
import ModelConfigClient from "./ModelConfigClient";

export const metadata = { title: "Billing | Admin" };
export const dynamic = "force-dynamic";

const DAILY_ROW_LIMIT = 10_000;

type FeatureAggregate = {
  feature: string;
  _count: { _all: number };
  _sum: { promptTokens: number | null; completionTokens: number | null; costUsd: number | null };
};

type ModelAggregate = {
  model: string;
  _count: { _all: number };
  _sum: { promptTokens: number | null; completionTokens: number | null; costUsd: number | null };
};

type DailyUsageRow = {
  createdAt: Date;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

type DailyAggregate = {
  date: string;
  requests: number;
  tokens: number;
  costUsd: number;
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const integer = new Intl.NumberFormat("en-US");

function featureLabel(key: string): string {
  return AI_FEATURES.find((feature) => feature.key === key)?.label ?? key;
}

export default async function BillingAdminPage() {
  const session = await auth();
  if (!session || !hasRole(session.user, "ADMIN")) {
    redirect("/dashboard");
  }

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 29);

  // Prisma delegates database waits to its connection lifecycle; the only network requests
  // on this page are client-side integration API calls, which carry explicit timeouts.
  const [featureGroups, modelGroups, dailyRows]: [
    FeatureAggregate[],
    ModelAggregate[],
    DailyUsageRow[],
  ] = await Promise.all([
    prisma.aiUsage.groupBy({
      by: ["feature"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    }),
    // The cap prevents an unexpectedly busy month from creating an unbounded server allocation.
    prisma.aiUsage.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: DAILY_ROW_LIMIT,
      select: { createdAt: true, promptTokens: true, completionTokens: true, costUsd: true },
    }),
  ]);

  featureGroups.sort((a, b) => (b._sum.costUsd ?? 0) - (a._sum.costUsd ?? 0));
  modelGroups.sort((a, b) => (b._sum.costUsd ?? 0) - (a._sum.costUsd ?? 0));

  const dailyByDate = new Map<string, DailyAggregate>();
  for (const row of dailyRows) {
    const date = row.createdAt.toISOString().slice(0, 10);
    const current = dailyByDate.get(date) ?? { date, requests: 0, tokens: 0, costUsd: 0 };
    current.requests += 1;
    current.tokens += row.promptTokens + row.completionTokens;
    current.costUsd += row.costUsd;
    dailyByDate.set(date, current);
  }
  const daily = [...dailyByDate.values()].sort((a, b) => b.date.localeCompare(a.date));

  const requestCount = featureGroups.reduce((sum, group) => sum + group._count._all, 0);
  const totalTokens = featureGroups.reduce(
    (sum, group) => sum + (group._sum.promptTokens ?? 0) + (group._sum.completionTokens ?? 0),
    0
  );
  const totalCost = featureGroups.reduce((sum, group) => sum + (group._sum.costUsd ?? 0), 0);
  const dailyIsCapped = dailyRows.length === DAILY_ROW_LIMIT;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <WalletCards className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Billing</h1>
        <span className="ml-auto hidden rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-400 sm:inline-block dark:border-slate-700 dark:bg-slate-800">
          Last 30 days
        </span>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-7xl space-y-8">
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">AI usage</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                OpenRouter spend and tokens recorded by hub AI features.
              </p>
            </div>

            {requestCount === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
                <p className="font-semibold text-slate-900 dark:text-white">No AI usage recorded yet</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Usage will appear after a lead brief or outreach email draft completes.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    ["Spend", usd.format(totalCost)],
                    ["Requests", integer.format(requestCount)],
                    ["Tokens", integer.format(totalTokens)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <UsageTable
                    title="By feature"
                    rows={featureGroups.map((group) => ({
                      label: featureLabel(group.feature),
                      requests: group._count._all,
                      tokens: (group._sum.promptTokens ?? 0) + (group._sum.completionTokens ?? 0),
                      costUsd: group._sum.costUsd ?? 0,
                    }))}
                  />
                  <UsageTable
                    title="By model"
                    rows={modelGroups.map((group) => ({
                      label: group.model,
                      requests: group._count._all,
                      tokens: (group._sum.promptTokens ?? 0) + (group._sum.completionTokens ?? 0),
                      costUsd: group._sum.costUsd ?? 0,
                    }))}
                  />
                </div>

                <UsageTable
                  title="By day (UTC)"
                  rows={daily.map((group) => ({
                    label: group.date,
                    requests: group.requests,
                    tokens: group.tokens,
                    costUsd: group.costUsd,
                  }))}
                />
                {dailyIsCapped && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Daily detail is limited to the {integer.format(DAILY_ROW_LIMIT)} most recent requests;
                    feature and model totals remain complete.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Models by feature</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Leave an override blank to use that feature&apos;s default model.
              </p>
            </div>
            <ModelConfigClient />
          </section>
        </div>
      </main>
    </div>
  );
}

type UsageTableRow = {
  label: string;
  requests: number;
  tokens: number;
  costUsd: number;
};

function UsageTable({ title, rows }: { title: string; rows: UsageTableRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 dark:bg-slate-950/50">
            <tr>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 text-right font-semibold">Requests</th>
              <th className="px-4 py-3 text-right font-semibold">Tokens</th>
              <th className="px-4 py-3 text-right font-semibold">Spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="max-w-xs truncate px-4 py-3 font-medium text-slate-900 dark:text-white">{row.label}</td>
                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{integer.format(row.requests)}</td>
                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{integer.format(row.tokens)}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-white">{usd.format(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
