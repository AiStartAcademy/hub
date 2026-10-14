// src/app/(dashboard)/admin/sessions/series/page.tsx
//
// Shared session series: recurring calls that belong to no single cohort. The daily
// check-in for the weekly Monday day cohorts lives here — one series, one Zoom link,
// attached to every cohort currently running.

import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { SERIES_WEEKDAYS } from "@/lib/seriesSchedule";
import { createSeriesAction } from "./actions";

export const metadata = { title: "Session Series | Admin" };
export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  CHECKIN: "Daily check-in",
  ONBOARDING: "Onboarding call",
};

const INPUT =
  "px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white";

export default async function AdminSessionSeriesPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, MANAGE_ROLES)) redirect("/dashboard");

  const [series, instructors] = await Promise.all([
    prisma.sessionSeries.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        instructor: { select: { name: true, email: true } },
        cohorts: { include: { cohort: { select: { id: true, title: true } } } },
        _count: { select: { occurrences: true } },
      },
    }),
    prisma.user.findMany({
      where: { OR: [{ role: "INSTRUCTOR" }, { role: "ADMIN" }] },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <CalendarClock className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Session series</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            A series is a recurring call that belongs to no single cohort. Attach it to as many
            cohorts as it serves — one daily check-in can cover every running day cohort at
            once. To split the load, create a second series and move a cohort&rsquo;s attachment to it.
          </p>

          {/* Create */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">New series</h2>
            <form action={createSeriesAction} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input name="title" required placeholder="Daily Check-in" className={`${INPUT} md:col-span-2`} />
                <select name="kind" className={INPUT} defaultValue="CHECKIN">
                  {Object.entries(KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <select name="instructorId" className={INPUT} defaultValue="">
                  <option value="">No default instructor</option>
                  {instructors.map((i) => (
                    <option key={i.id} value={i.id}>{i.name || i.email}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <input name="startDate" type="date" required className={INPUT} aria-label="First day" />
                <input name="endDate" type="date" className={INPUT} aria-label="Last day (blank = rolling)" />
                <input name="startTime" type="time" required defaultValue="11:00" className={INPUT} aria-label="Start time" />
                <input name="endTime" type="time" required defaultValue="12:00" className={INPUT} aria-label="End time" />
                <input name="timezone" defaultValue="America/Los_Angeles" className={INPUT} aria-label="Timezone" />
              </div>

              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="sr-only">Days of the week</legend>
                {SERIES_WEEKDAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      name="days"
                      value={d}
                      defaultChecked={d !== "SAT" && d !== "SUN"}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    {d}
                  </label>
                ))}
              </fieldset>

              <input name="description" placeholder="Description (optional)" className={`${INPUT} w-full`} />

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Leave the last day blank for a rolling series. Zoom is provisioned separately,
                  so a mistyped schedule never mints a real recurring meeting.
                </p>
                <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:opacity-90 flex-shrink-0">
                  Create
                </button>
              </div>
            </form>
          </div>

          {/* List */}
          <div className="space-y-3">
            {series.length === 0 && (
              <p className="text-sm text-slate-400">No series yet.</p>
            )}
            {series.map((s) => (
              <Link
                key={s.id}
                href={`/admin/sessions/series/${s.id}`}
                className="block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 dark:text-white">{s.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {KIND_LABELS[s.kind] ?? s.kind}
                      </span>
                      {s.status !== "ACTIVE" && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          {s.status}
                        </span>
                      )}
                      {!s.zoomMeetingId && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400">
                          No Zoom yet
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      {s.days.split(",").join(" · ")} — {s.startTime}–{s.endTime} {s.timezone}
                      {!s.endDate && " · rolling"}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                      <Users className="h-3 w-3" />
                      {s.cohorts.length === 0
                        ? "No cohorts attached"
                        : s.cohorts.map((c) => c.cohort.title).join(", ")}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{s._count.occurrences}</p>
                    <p className="text-xs text-slate-400">occurrences</p>
                    {s.instructor && (
                      <p className="text-xs text-slate-400 mt-1">{s.instructor.name || s.instructor.email}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
