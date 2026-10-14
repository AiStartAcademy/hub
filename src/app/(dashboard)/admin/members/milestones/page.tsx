// src/app/(dashboard)/admin/members/milestones/page.tsx
//
// Verification queue for self-reported milestone achievements.

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { Award, ArrowLeft } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { reviewMilestoneAchievement } from "../actions";

export const metadata = { title: "Milestones | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminMilestonesPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, MANAGE_ROLES)) redirect("/dashboard");

  const [pending, recentVerified] = await Promise.all([
    prisma.milestoneAchievement.findMany({
      where: { status: "pending" },
      include: {
        user: { select: { name: true, email: true } },
        milestone: { select: { title: true, order: true } },
      },
      orderBy: { achievedAt: "asc" },
    }),
    prisma.milestoneAchievement.findMany({
      where: { status: "verified" },
      include: {
        user: { select: { name: true, email: true } },
        milestone: { select: { title: true } },
        verifiedBy: { select: { name: true } },
      },
      orderBy: { achievedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Link href="/admin/members" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <Award className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Milestone verification</h1>
        {pending.length > 0 && (
          <span className="ml-auto rounded-full bg-amber-100 text-amber-700 px-3 py-1 text-xs font-bold">
            {pending.length} pending
          </span>
        )}
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Pending review</h2>
            {pending.length === 0 && <p className="text-sm text-slate-500">Nothing waiting. 🎉</p>}
            {pending.map((a) => (
              <div key={a.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {a.milestone.title} — {a.user.name ?? a.user.email}
                  </p>
                  <p className="text-xs text-slate-500">
                    Reported {a.achievedAt.toLocaleDateString()}
                    {a.note ? ` · "${a.note}"` : ""}
                  </p>
                  {a.evidenceUrl && (
                    <a href={a.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline break-all">
                      {a.evidenceUrl}
                    </a>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <form action={reviewMilestoneAchievement}>
                    <input type="hidden" name="achievementId" value={a.id} />
                    <input type="hidden" name="decision" value="verify" />
                    <button type="submit" className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">Verify</button>
                  </form>
                  <form action={reviewMilestoneAchievement}>
                    <input type="hidden" name="achievementId" value={a.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <button type="submit" className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Reject</button>
                  </form>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recently verified</h2>
            {recentVerified.map((a) => (
              <div key={a.id} className="px-4 py-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                <span className="font-medium">{a.milestone.title}</span> — {a.user.name ?? a.user.email}
                {a.verifiedBy?.name ? ` · verified by ${a.verifiedBy.name}` : ""}
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
