// src/app/(dashboard)/dashboard/page.tsx

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users, BookOpen, TrendingUp, Calendar,
  UserPlus, ArrowUpRight, Clock,
} from "lucide-react";
import type { Prisma } from "@/generated/client";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import CohortCalendar from "@/components/CohortCalendar";
import ClientTime from "@/components/ClientTime";
import RecordingsSection from "@/components/RecordingsSection";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getDashboardStats, getRecentActivity, type DashboardStat } from "@/lib/dashboardStats";
import { getRecordingsFeed } from "@/lib/recordings";
import { getVisibleSeriesOccurrences } from "@/lib/seriesSchedule";

// Presentation only — the numbers themselves come from getDashboardStats().
const STAT_STYLES: Record<
  DashboardStat["key"],
  { icon: typeof Users; bgColor: string; textColor: string }
> = {
  cohorts: {
    icon: Users,
    bgColor: "bg-primary/10 dark:bg-primary/20",
    textColor: "text-primary",
  },
  students: {
    icon: UserPlus,
    bgColor: "bg-emerald-50 dark:bg-emerald-900/20",
    textColor: "text-emerald-600 dark:text-emerald-400",
  },
  courses: {
    icon: BookOpen,
    bgColor: "bg-sky-50 dark:bg-sky-900/20",
    textColor: "text-sky-600 dark:text-sky-400",
  },
};

export default async function DashboardPage() {
  const session = await auth();

  // Protect the route from unauthorized access
  if (!session?.user) {
    redirect("/login");
  }

  const userRole = session.user.role || "STUDENT";
  const userId = session.user.id as string;
  const firstName = session.user.name?.split(" ")[0] || "User";

  const isStudent = userRole === "STUDENT";

    const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Build a role-based filter
  const whereClause: Prisma.CohortSessionWhereInput = {
    date: {
      gte: today, // Today or later only
    },
  };

  if (userRole === "STUDENT") {
    // Students see only their own cohorts
    whereClause.cohort = {
      enrollments: { some: { userId: userId, status: "active" } },
    };
  } else if (userRole === "INSTRUCTOR") {
    // Instructors see the schedule of the cohorts they teach
    whereClause.cohort = {
      instructors: { some: { id: userId } },
    };
  }
  // ADMIN and TEAM_MEMBER see the schedule of all active cohorts

  // 2. Load the data
  const upcomingDbSessions = await prisma.cohortSession.findMany({
    where: whereClause,
    orderBy: {
      date: "asc",
    },
    take: 10, // Over-fetch in case some are already "Completed"
    include: {
      cohort: {
        select: { title: true },
      },
    },
  });

  // Shared check-in calls are SeriesOccurrence rows, not CohortSession rows (see
  // prisma/schema.prisma "Shared Session Series"). Normalize them into the same shape
  // this widget already maps over, so a student whose cohort is attached to the daily
  // check-in sees it here alongside their own cohort's sessions.
  const upcomingSeries = await getVisibleSeriesOccurrences(
    { userId, role: userRole },
    { from: today, take: 10 }
  );

  const upcomingSessions = [
    ...upcomingDbSessions.map((s) => ({
      title: s.title,
      contextTitle: s.cohort.title,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    })),
    ...upcomingSeries.map((o) => ({
      title: o.title,
      contextTitle: o.context,
      date: o.date,
      startTime: o.startTime,
      endTime: o.endTime,
      status: o.status,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const now = new Date();

  // 3. Compute statuses and send ISO times to the client
  const displaySessions = upcomingSessions
    .map((s) => {
      let actualStatus = "Scheduled";
      let isUrgent = false;
      let formattedTime = `${new Date(s.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${s.startTime}`; 
      let isoTimeStr = null;

      if (s.startTime?.includes("T") && s.startTime?.includes("Z")) {
         const startDate = new Date(s.startTime);
         const endDate = new Date(s.endTime);
         isoTimeStr = s.startTime; // ISO string for ClientTime

         if (now > endDate) {
            actualStatus = "Completed";
         } else if (now >= startDate && now <= endDate) {
            actualStatus = "Live Now";
            isUrgent = true;
         } else {
            actualStatus = "Scheduled";
            isUrgent = startDate.getTime() - now.getTime() <= 24 * 60 * 60 * 1000;
         }

         const timeOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } as const;
         formattedTime = `${startDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: 'UTC' })}, ${startDate.toLocaleTimeString("en-US", timeOptions)} UTC`;
      } else {
         const sessionDate = new Date(s.date);
         isUrgent = sessionDate.getTime() - now.getTime() <= 24 * 60 * 60 * 1000 && sessionDate.getTime() >= now.getTime();
         actualStatus = s.status === "upcoming" ? "Scheduled" : s.status;
      }

      return {
        title: s.title,
        cohort: s.contextTitle,
        time: formattedTime,
        isoTime: isoTimeStr,
        status: actualStatus,
        urgent: isUrgent,
      };
    })
    .filter((s) => s.status !== "Completed") // Hide completed sessions in the widget
    .slice(0, 5); // Keep the next 5

  // Real dashboard data. Stats/activity are staff-only widgets, so they are not
  // even queried for students.
  const [stats, recentActivity, recordingsFeed] = await Promise.all([
    isStudent ? Promise.resolve([]) : getDashboardStats(userRole, userId),
    isStudent ? Promise.resolve([]) : getRecentActivity(userRole, userId),
    getRecordingsFeed(session.user, userId),
  ]);

  const recordingCards = recordingsFeed.items.map((r) => ({
    id: r.id,
    title: r.title,
    context: r.context,
    summary: r.summary,
    topics: r.topics,
    videoUrl: r.videoUrl,
    posterUrl: r.posterUrl,
    duration: r.duration,
    href: r.href,
    recordedLabel: r.recordedAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  }));

  return (
    <>
      {/* Header */}
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between px-4 md:px-8 flex-shrink-0 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <MobileMenuButton />
          <div className="min-w-0">
            <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white truncate">
              Dashboard
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              Welcome back, {firstName} 👋
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
            <Clock className="h-4 w-4" />
            <span>
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          {/* Stats Grid - Hidden for STUDENTS */}
          {!isStudent && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {stats.map((stat, i) => {
                const style = STAT_STYLES[stat.key];
                const Icon = style.icon;
                return (
                  <div
                    key={stat.label}
                    className={`animate-fade-in stagger-${i + 1} bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 p-5 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 group`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div
                        className={`w-10 h-10 rounded-lg ${style.bgColor} flex items-center justify-center`}
                      >
                        <Icon className={`h-5 w-5 ${style.textColor}`} />
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-primary transition-colors" />
                    </div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                      {stat.value}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      {stat.label}
                    </p>
                    {stat.change && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {stat.change}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Cohort Calendar */}
          <CohortCalendar />

          <div
            className={`grid grid-cols-1 ${
              isStudent ? "lg:grid-cols-1" : "lg:grid-cols-5"
            } gap-8`}
          >
            {/* Upcoming Sessions */}
            <div
              className={`${
                isStudent ? "lg:col-span-1" : "lg:col-span-3"
              } bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in`}
            >
              <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700/50 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  Upcoming Sessions
                </h2>
                <Link
                  href="/cohorts"
                  className="text-sm text-primary hover:text-primary-dark font-medium transition-colors"
                >
                  View all →
                </Link>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {displaySessions.length > 0 ? (
                  displaySessions.map((session, i) => (
                    <div
                      key={i}
                      className={`px-6 py-4 flex items-center gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${
                        session.urgent
                          ? "border-l-4 border-l-primary bg-primary/5 dark:bg-primary/5"
                          : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {session.title}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {session.cohort} · {session.isoTime ? <ClientTime isoString={session.isoTime} fallback={session.time} /> : session.time}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
                          session.urgent
                            ? "bg-primary text-white animate-pulse"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                    No upcoming sessions found.
                  </div>
                )}
              </div>
            </div>

            {/* Recent Activity - Hidden for STUDENTS */}
            {!isStudent && (
              <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in">
                <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                    Recent Activity
                  </h2>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recentActivity.length === 0 && (
                    <div className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                      No activity yet.
                    </div>
                  )}
                  {recentActivity.map((item, i) => (
                    <div
                      key={i}
                      className="px-6 py-3.5 flex items-start gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/80 to-accent/80 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                        {item.avatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {item.user}
                          </span>{" "}
                          {item.action}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          {item.time}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Latest recordings across every cohort */}
          <RecordingsSection
            recordings={recordingCards}
            isMember={recordingsFeed.isMember}
          />
        </div>
      </div>
    </>
  );
}
