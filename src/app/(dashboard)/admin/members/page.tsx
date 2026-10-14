// src/app/(dashboard)/admin/members/page.tsx
//
// Membership administration: every Membership row, MRR summary, comp grants.
// Paid rows are read-only here (cancel them in Stripe; the webhook syncs) —
// only comp_ rows can be revoked locally.

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { ADMIN_ROLES, MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { getMembersActivity } from "@/lib/memberProgress";
import { BadgeCheck, Users, Award, CalendarDays } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { compMembership, revokeCompMembership } from "./actions";

export const metadata = { title: "Members | Admin" };
export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  past_due: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  pending: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  canceled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default async function AdminMembersPage() {
  const session = await auth();
  // Instructors and team members can view (to help students navigate);
  // comp grant/revoke actions stay ADMIN-gated server-side.
  if (!session || !hasAnyRole(session.user, MANAGE_ROLES)) redirect("/dashboard");
  const isAdmin = hasAnyRole(session.user, ADMIN_ROLES);

  const memberships = await prisma.membership.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true, email: true } } },
    take: 500,
  });
  const activity = await getMembersActivity(
    [...new Set(memberships.map((m) => m.userId).filter((id): id is string => !!id))]
  );

  const active = memberships.filter((m) => m.status === "active");
  const mrrCents = active.reduce((acc, m) => acc + m.amount, 0);
  const compCount = active.filter((m) => m.stripeSessionId.startsWith("comp_")).length;

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <BadgeCheck className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Members</h1>
        <nav className="ml-auto flex items-center gap-2 text-xs font-medium">
          <Link href="/admin/members/pods" className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Users className="h-3.5 w-3.5" /> Pods
          </Link>
          <Link href="/admin/members/milestones" className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            <Award className="h-3.5 w-3.5" /> Milestones
          </Link>
          <Link href="/admin/members/events" className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            <CalendarDays className="h-3.5 w-3.5" /> Events
          </Link>
        </nav>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Active members", value: String(active.length) },
              { label: "MRR", value: `$${(mrrCents / 100).toLocaleString()}` },
              { label: "Accelerator", value: String(active.filter((m) => m.tier === "ACCELERATOR").length) },
              { label: "Comped", value: String(compCount) },
            ].map((s) => (
              <div key={s.label} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className="text-xl font-bold text-slate-900 dark:text-white">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Comp grant */}
          {isAdmin && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Grant complimentary membership</h2>
            <form action={compMembership} className="flex flex-wrap items-end gap-2">
              <input name="email" type="email" required placeholder="member@email.com"
                className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              <select name="tier" className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                <option value="MENTOR_NETWORK">Recordings ($50 tier)</option>
                <option value="ACCELERATOR">Accelerator ($500 tier)</option>
              </select>
              <select name="months" className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                <option value="0">Open-ended</option>
                <option value="1">1 month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
              </select>
              <button type="submit" className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90">
                Grant
              </button>
            </form>
          </div>
          )}

          {/* Membership list */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Lessons</th>
                  <th className="px-4 py-3">Last active</th>
                  <th className="px-4 py-3">Period end</th>
                  <th className="px-4 py-3">Since</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => {
                  const isComp = m.stripeSessionId.startsWith("comp_");
                  const act = m.userId ? activity.get(m.userId) : undefined;
                  const staleDays = act?.lastActivityAt
                    ? Math.floor((Date.now() - act.lastActivityAt.getTime()) / 86400000)
                    : null;
                  return (
                    <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <td className="px-4 py-3">
                        {m.userId ? (
                          <Link href={`/admin/members/${m.userId}`} className="group">
                            <p className="font-medium text-slate-900 dark:text-white group-hover:text-primary group-hover:underline">
                              {m.user?.name ?? m.buyerName ?? "—"}
                            </p>
                            <p className="text-xs text-slate-500">{m.user?.email ?? m.buyerEmail}</p>
                          </Link>
                        ) : (
                          <>
                            <p className="font-medium text-slate-900 dark:text-white">{m.buyerName ?? "—"}</p>
                            <p className="text-xs text-slate-500">{m.buyerEmail}</p>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {m.tier === "ACCELERATOR" ? "Accelerator" : "Recordings"}
                        {isComp && <span className="ml-1 text-[10px] uppercase text-violet-600 font-bold">comp</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[m.status] ?? STATUS_STYLES.pending}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">${(m.amount / 100).toFixed(0)}/mo</td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {act?.lessonsCompleted ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {act?.lastActivityAt ? (
                          <span className={staleDays !== null && staleDays > 14 && m.status === "active" ? "text-amber-600 font-medium" : "text-slate-500"}>
                            {staleDays === 0 ? "today" : `${staleDays}d ago`}
                          </span>
                        ) : (
                          <span className="text-slate-400">never</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {m.currentPeriodEnd ? m.currentPeriodEnd.toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{m.createdAt.toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        {isComp && m.status === "active" && (
                          <form action={revokeCompMembership}>
                            <input type="hidden" name="membershipId" value={m.id} />
                            <button type="submit" className="text-xs text-red-600 hover:underline">Revoke</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
