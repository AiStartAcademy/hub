// src/app/(dashboard)/admin/members/[userId]/page.tsx
//
// Staff view of one member: membership state, course progress (from
// LessonProgress), milestone ladder, pod — everything needed to help them
// navigate the course. MANAGE_ROLES so instructors and team members can use it.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { getMembershipSnapshot } from "@/lib/entitlements";
import { getMemberProgress } from "@/lib/memberProgress";
import { ArrowLeft, UserRound, BookOpen, Award, Users } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";

export const metadata = { title: "Member | Admin" };
export const dynamic = "force-dynamic";

function daysAgo(date: Date | null): string {
  if (!date) return "never";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export default async function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, MANAGE_ROLES)) redirect("/dashboard");

  const { userId } = await params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      memberships: {
        orderBy: { createdAt: "desc" },
        select: { id: true, tier: true, status: true, stripeSessionId: true, currentPeriodEnd: true, createdAt: true },
      },
      milestoneAchievements: {
        include: { milestone: { select: { title: true, order: true } } },
        orderBy: { achievedAt: "asc" },
      },
      podMembers: {
        where: { leftAt: null },
        include: { pod: { select: { id: true, name: true, coach: { select: { name: true } } } } },
      },
      enrollments: {
        include: { cohort: { select: { title: true } } },
      },
    },
  });
  if (!user) notFound();

  const [snap, progress, milestonesTotal] = await Promise.all([
    getMembershipSnapshot(user.id),
    getMemberProgress(user.id),
    prisma.milestone.count(),
  ]);

  const stale =
    progress.lastActivityAt &&
    Date.now() - progress.lastActivityAt.getTime() > 14 * 86400000;

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Link href="/admin/members" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <UserRound className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">
          {user.name ?? user.email}
        </h1>
        {snap.isMember && (
          <span className="ml-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold">
            {snap.tier === "ACCELERATOR" ? "Accelerator" : "Recordings"}
          </span>
        )}
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Member since", value: user.createdAt.toLocaleDateString() },
              {
                label: "Membership",
                value: snap.isMember
                  ? `${snap.tier === "ACCELERATOR" ? "Accelerator" : "Recordings"} · ${snap.status}`
                  : "none",
              },
              { label: "Lessons completed", value: String(progress.lessonsCompletedTotal) },
              { label: "Last activity", value: daysAgo(progress.lastActivityAt) },
            ].map((s) => (
              <div key={s.label} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4">
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{s.value}</p>
              </div>
            ))}
          </div>

          {stale && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
              No lesson activity in over two weeks — a good moment for a personal check-in.
            </div>
          )}

          {/* Course progress */}
          <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <BookOpen className="h-4 w-4 text-primary" /> Course progress
            </h2>
            {progress.programs.length === 0 ? (
              <p className="text-sm text-slate-500">No lessons completed yet.</p>
            ) : (
              <div className="space-y-4">
                {progress.programs.map((p) => (
                  <div key={p.programId}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-slate-900 dark:text-white">{p.programName}</span>
                      <span className="text-xs text-slate-500">
                        {p.lessonsCompleted}/{p.lessonsTotal} lessons · {p.percent}% · last {daysAgo(p.lastActivityAt)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${p.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Milestones */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <Award className="h-4 w-4 text-primary" /> Milestones ({user.milestoneAchievements.filter((a) => a.status === "verified").length}/{milestonesTotal} verified)
              </h2>
              {user.milestoneAchievements.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing reported yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {user.milestoneAchievements.map((a) => (
                    <li key={a.id} className="flex items-center justify-between">
                      <span className="text-slate-700 dark:text-slate-300">{a.milestone.title}</span>
                      <span className={`text-xs font-medium ${a.status === "verified" ? "text-emerald-600" : "text-amber-600"}`}>
                        {a.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Pod + cohorts */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-primary" /> Pod & cohorts
              </h2>
              <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1.5">
                {user.podMembers.length > 0 ? (
                  user.podMembers.map((pm) => (
                    <p key={pm.id}>
                      Pod: <span className="font-medium">{pm.pod.name}</span>
                      {pm.pod.coach?.name ? ` · coach ${pm.pod.coach.name}` : ""}
                    </p>
                  ))
                ) : (
                  <p className="text-slate-500">No pod.</p>
                )}
                {user.enrollments.length > 0 ? (
                  <p>Cohorts: {user.enrollments.map((e) => e.cohort.title).join(", ")}</p>
                ) : (
                  <p className="text-slate-500">No cohort enrollments.</p>
                )}
              </div>
            </section>
          </div>

          {/* Membership history */}
          <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Membership history</h2>
            <ul className="space-y-1.5 text-sm">
              {user.memberships.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-slate-700 dark:text-slate-300">
                  <span>
                    {m.tier === "ACCELERATOR" ? "Accelerator" : "Recordings"}
                    {m.stripeSessionId.startsWith("comp_") && (
                      <span className="ml-1 text-[10px] uppercase text-violet-600 font-bold">comp</span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500">
                    {m.status} · since {m.createdAt.toLocaleDateString()}
                    {m.currentPeriodEnd ? ` · period ends ${m.currentPeriodEnd.toLocaleDateString()}` : ""}
                  </span>
                </li>
              ))}
              {user.memberships.length === 0 && <li className="text-slate-500">No membership rows.</li>}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
