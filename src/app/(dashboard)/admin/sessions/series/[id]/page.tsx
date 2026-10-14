// Series detail: edit the schedule, attach cohorts, and assign an instructor per date.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { SERIES_WEEKDAYS, toInputTime } from "@/lib/seriesSchedule";
import { fmtSessionWhen } from "@/lib/sessionTime";
import { assignOccurrenceAction, setSeriesCohortsAction, updateSeriesAction } from "../actions";
import ZoomPanel from "./ZoomPanel";

export const dynamic = "force-dynamic";

const INPUT =
  "px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white";
const CARD = "bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4";

function toInputDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, MANAGE_ROLES)) redirect("/dashboard");

  const { id } = await params;

  const [series, cohorts, instructors] = await Promise.all([
    prisma.sessionSeries.findUnique({
      where: { id },
      include: {
        cohorts: { select: { cohortId: true } },
        occurrences: {
          orderBy: { date: "asc" },
          include: { instructor: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
    // Only cohorts that are still selling or running can meaningfully attend a check-in.
    prisma.cohort.findMany({
      where: { status: { in: ["DRAFT", "ENROLLMENT", "IN_PROGRESS"] } },
      select: { id: true, title: true, status: true, startDate: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.user.findMany({
      where: { OR: [{ role: "INSTRUCTOR" }, { role: "ADMIN" }] },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!series) notFound();

  const attached = new Set(series.cohorts.map((c) => c.cohortId));
  const selectedDays = new Set(series.days.split(","));
  const now = Date.now();

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Link href="/admin/sessions/series" className="text-slate-400 hover:text-slate-600">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <CalendarClock className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white truncate">{series.title}</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Schedule */}
          <div className={CARD}>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Schedule</h2>
            <form action={updateSeriesAction} className="space-y-3">
              <input type="hidden" name="id" value={series.id} />
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input name="title" required defaultValue={series.title} className={`${INPUT} md:col-span-2`} />
                <select name="kind" defaultValue={series.kind} className={INPUT}>
                  <option value="CHECKIN">Daily check-in</option>
                  <option value="ONBOARDING">Onboarding call</option>
                </select>
                <select name="status" defaultValue={series.status} className={INPUT}>
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <input name="startDate" type="date" required defaultValue={toInputDate(series.startDate)} className={INPUT} />
                <input name="endDate" type="date" defaultValue={toInputDate(series.endDate)} className={INPUT} />
                <input name="startTime" type="time" required defaultValue={toInputTime(series.startTime)} className={INPUT} />
                <input name="endTime" type="time" required defaultValue={toInputTime(series.endTime)} className={INPUT} />
                <input name="timezone" defaultValue={series.timezone} className={INPUT} />
              </div>
              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="sr-only">Days of the week</legend>
                {SERIES_WEEKDAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" name="days" value={d} defaultChecked={selectedDays.has(d)}
                      className="rounded border-slate-300 dark:border-slate-600" />
                    {d}
                  </label>
                ))}
              </fieldset>
              <select name="instructorId" defaultValue={series.instructorId ?? ""} className={`${INPUT} w-full md:w-72`}>
                <option value="">No default instructor</option>
                {instructors.map((i) => (
                  <option key={i.id} value={i.id}>{i.name || i.email}</option>
                ))}
              </select>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Changing the schedule here does not reshape an already-provisioned Zoom meeting —
                  re-provision it afterwards so the two never drift apart silently.
                </p>
                <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:opacity-90 flex-shrink-0">
                  Save
                </button>
              </div>
            </form>
          </div>

          {/* Zoom */}
          <div className={CARD}>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Zoom</h2>
            <p className="text-xs text-slate-400 mb-3">
              One recurring meeting for the whole series — the single link every attached
              cohort joins. Provisioned a horizon at a time for a rolling series; re-sync to
              pull new dates in.
            </p>
            <ZoomPanel seriesId={series.id} zoomLink={series.zoomLink} />
          </div>

          {/* Attachments */}
          <div className={CARD}>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Cohorts served</h2>
            <p className="text-xs text-slate-400 mb-3">
              Every student enrolled in a checked cohort sees this call. Unchecking detaches —
              that is how a cohort is handed to another instructor&rsquo;s series.
            </p>
            <form action={setSeriesCohortsAction} className="space-y-3">
              <input type="hidden" name="id" value={series.id} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {cohorts.length === 0 && <p className="text-sm text-slate-400">No open cohorts.</p>}
                {cohorts.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" name="cohortIds" value={c.id} defaultChecked={attached.has(c.id)}
                      className="rounded border-slate-300 dark:border-slate-600" />
                    <span className="truncate">{c.title}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">{c.status}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:opacity-90">
                Save attachments
              </button>
            </form>
          </div>

          {/* Occurrences */}
          <div className={CARD}>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Occurrences</h2>
            <p className="text-xs text-slate-400 mb-3">
              Dates come from Zoom. Assigning an instructor here overrides the series default for
              that date only — the day-to-day way to split the load.
            </p>
            {series.occurrences.length === 0 && (
              <p className="text-sm text-slate-400">
                None yet — provision the Zoom meeting and sync to pull the schedule in.
              </p>
            )}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {series.occurrences.map((o) => {
                const past = Date.parse(o.endTime) < now;
                return (
                  <div key={o.id} className={`flex items-center justify-between gap-3 py-2 ${past ? "opacity-50" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 dark:text-white truncate">{o.title}</p>
                      <p className="text-xs text-slate-400">
                        {fmtSessionWhen(o.startTime, o.timezone) ?? o.date.toDateString()}
                        {o.recordingLink && " · recorded"}
                      </p>
                    </div>
                    <form action={assignOccurrenceAction} className="flex items-center gap-2 flex-shrink-0">
                      <input type="hidden" name="seriesId" value={series.id} />
                      <input type="hidden" name="occurrenceId" value={o.id} />
                      <select name="instructorId" defaultValue={o.instructorId ?? ""} className={`${INPUT} py-1.5`}>
                        <option value="">Series default</option>
                        {instructors.map((i) => (
                          <option key={i.id} value={i.id}>{i.name || i.email}</option>
                        ))}
                      </select>
                      <button type="submit" className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                        Assign
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
