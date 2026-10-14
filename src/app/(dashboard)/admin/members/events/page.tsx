// src/app/(dashboard)/admin/members/events/page.tsx
//
// Member call schedule: create weekly coaching / deal desk / build sprint /
// weekly Q&A events, update status, attach recording links.

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { CalendarDays, ArrowLeft } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { createMemberEvent, updateMemberEvent } from "../actions";

export const metadata = { title: "Member Events | Admin" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  COACHING: "Coaching call",
  DEAL_DESK: "Deal desk",
  BUILD_SPRINT: "Build sprint",
  WEEKLY_QA: "Weekly Q&A",
};

export default async function AdminMemberEventsPage() {
  const session = await auth();
  if (!session || !hasAnyRole(session.user, MANAGE_ROLES)) redirect("/dashboard");

  const events = await prisma.memberEvent.findMany({
    orderBy: { date: "desc" },
    take: 100,
  });

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="z-10 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm md:px-8 dark:border-slate-800 dark:bg-slate-900">
        <MobileMenuButton />
        <Link href="/admin/members" className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></Link>
        <CalendarDays className="h-5 w-5 flex-shrink-0 text-slate-400" />
        <h1 className="text-base font-bold text-slate-900 md:text-xl dark:text-white">Member events</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Schedule event</h2>
            <form action={createMemberEvent} className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
              <select name="type" className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input name="title" required placeholder="Title"
                className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white md:col-span-3" />
              <input name="date" type="date" required
                className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              <input name="startTime" type="time" required defaultValue="18:00"
                className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              <input name="endTime" type="time" required defaultValue="19:00"
                className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              <select name="minTier" className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                <option value="MENTOR_NETWORK">All members</option>
                <option value="ACCELERATOR">Accelerator only</option>
              </select>
              <input name="meetingLink" placeholder="Meeting link (optional)"
                className="px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white md:col-span-3" />
              <button type="submit" className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90">
                Schedule
              </button>
            </form>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Recording</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-white">{e.title}</p>
                      <p className="text-xs text-slate-500">{TYPE_LABELS[e.type] ?? e.type}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {e.date.toLocaleDateString()} {e.startTime}–{e.endTime} {e.timezone}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {e.minTier === "ACCELERATOR" ? "Accelerator" : "All"}
                    </td>
                    <td className="px-4 py-3">
                      <form action={updateMemberEvent} className="flex items-center gap-1">
                        <input type="hidden" name="eventId" value={e.id} />
                        <select name="status" defaultValue={e.status}
                          className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white">
                          <option value="upcoming">upcoming</option>
                          <option value="live">live</option>
                          <option value="completed">completed</option>
                          <option value="canceled">canceled</option>
                        </select>
                        <button type="submit" className="text-xs text-primary hover:underline">Save</button>
                      </form>
                    </td>
                    <td className="px-4 py-3">
                      <form action={updateMemberEvent} className="flex items-center gap-1">
                        <input type="hidden" name="eventId" value={e.id} />
                        <input name="recordingLink" defaultValue={e.recordingLink ?? ""} placeholder="Recording URL"
                          className="w-40 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
                        <button type="submit" className="text-xs text-primary hover:underline">Save</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
