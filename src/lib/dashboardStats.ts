// src/lib/dashboardStats.ts
//
// Real numbers for the /dashboard widgets. Everything here is derived from the
// database — no placeholder/sample values. Scoping rules:
//   ADMIN / TEAM_MEMBER → the whole academy
//   INSTRUCTOR          → only cohorts they teach
// Students never see these widgets (the dashboard hides the whole grid), so
// there is no student scope.

import type { Prisma } from "@/generated/client";
import prisma from "@/lib/prisma";

export interface DashboardStat {
  key: "cohorts" | "students" | "courses";
  label: string;
  value: string;
  /** Sub-line under the number. `null` when there is nothing truthful to say. */
  change: string | null;
}

export interface ActivityItem {
  user: string;
  action: string;
  /** Relative label, computed server-side so it matches the query snapshot. */
  time: string;
  avatar: string;
  at: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cohorts that count as "running right now". */
const ACTIVE_COHORT_STATUSES = ["ENROLLMENT", "IN_PROGRESS"];

function cohortScope(userRole: string, userId: string): Prisma.CohortWhereInput {
  if (userRole === "INSTRUCTOR") {
    return { instructors: { some: { id: userId } } };
  }
  return {};
}

function initials(name: string | null | undefined, email?: string | null): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function displayName(name: string | null | undefined, email?: string | null): string {
  return (name || email || "Someone").trim();
}

function relativeTime(from: Date, now: Date): string {
  const diff = Math.max(0, now.getTime() - from.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export async function getDashboardStats(
  userRole: string,
  userId: string
): Promise<DashboardStat[]> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const scope = cohortScope(userRole, userId);
  // Enrollment/student counts are scoped through the cohort, so an instructor
  // sees their own students rather than the whole academy.
  const enrollmentScope: Prisma.EnrollmentWhereInput =
    userRole === "INSTRUCTOR" ? { cohort: scope } : {};

  const [
    activeCohorts,
    startingThisMonth,
    students,
    newEnrollments,
    publishedPrograms,
    draftPrograms,
  ] = await Promise.all([
    prisma.cohort.count({ where: { ...scope, status: { in: ACTIVE_COHORT_STATUSES } } }),
    prisma.cohort.count({ where: { ...scope, startDate: { gte: monthStart } } }),
    prisma.user.count({ where: { enrollments: { some: enrollmentScope } } }),
    prisma.enrollment.count({ where: { ...enrollmentScope, createdAt: { gte: weekAgo } } }),
    prisma.program.count({ where: { status: "open" } }),
    prisma.program.count({ where: { status: "draft" } }),
  ]);

  return [
    {
      key: "cohorts",
      label: "Active Cohorts",
      value: String(activeCohorts),
      change: startingThisMonth > 0 ? `${startingThisMonth} starting this month` : null,
    },
    {
      key: "students",
      label: "Total Students",
      value: String(students),
      change: newEnrollments > 0 ? `+${newEnrollments} enrolled this week` : null,
    },
    {
      key: "courses",
      label: "Courses Published",
      value: String(publishedPrograms),
      change: draftPrograms > 0 ? `${draftPrograms} draft${draftPrograms === 1 ? "" : "s"} pending` : null,
    },
  ];
}

/**
 * Recent activity, merged from the four things that actually generate events:
 * enrollments, lesson completions, certificates issued and paid checkouts.
 * Each source is queried small and merged in memory — SQLite has no cheap
 * cross-table union and these are all indexed `createdAt` reads.
 */
export async function getRecentActivity(
  userRole: string,
  userId: string,
  limit = 6
): Promise<ActivityItem[]> {
  const now = new Date();
  const scope = cohortScope(userRole, userId);
  const scoped = userRole === "INSTRUCTOR" ? { cohort: scope } : {};
  const take = limit * 2;

  const [enrollments, progress, certificates, payments] = await Promise.all([
    prisma.enrollment.findMany({
      where: scoped,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        createdAt: true,
        source: true,
        user: { select: { name: true, email: true } },
        cohort: { select: { title: true } },
      },
    }),
    prisma.lessonProgress.findMany({
      where: userRole === "INSTRUCTOR" ? { cohort: scope } : {},
      orderBy: { createdAt: "desc" },
      take,
      select: {
        createdAt: true,
        user: { select: { name: true, email: true } },
        lesson: { select: { name: true } },
      },
    }),
    prisma.certificate.findMany({
      where: userRole === "INSTRUCTOR" ? { cohort: scope } : {},
      orderBy: { issuedAt: "desc" },
      take,
      select: {
        issuedAt: true,
        user: { select: { name: true, email: true } },
        cohort: { select: { title: true } },
      },
    }),
    prisma.payment.findMany({
      // Only `paid` — pending/failed rows are not revenue and not an event.
      where: { ...scoped, status: "paid" },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        updatedAt: true,
        buyerName: true,
        buyerEmail: true,
        user: { select: { name: true, email: true } },
        cohort: { select: { title: true } },
        venueEvent: { select: { title: true } },
      },
    }),
  ]);

  const items: ActivityItem[] = [
    ...enrollments.map((e) => ({
      at: e.createdAt,
      user: displayName(e.user.name, e.user.email),
      avatar: initials(e.user.name, e.user.email),
      action:
        e.source === "luma"
          ? `joined ${e.cohort.title} via Luma`
          : `enrolled in ${e.cohort.title}`,
      time: "",
    })),
    ...progress.map((p) => ({
      at: p.createdAt,
      user: displayName(p.user.name, p.user.email),
      avatar: initials(p.user.name, p.user.email),
      action: `completed ${p.lesson.name}`,
      time: "",
    })),
    ...certificates.map((c) => ({
      at: c.issuedAt,
      user: displayName(c.user.name, c.user.email),
      avatar: initials(c.user.name, c.user.email),
      action: `earned a certificate for ${c.cohort.title}`,
      time: "",
    })),
    ...payments.map((p) => {
      // A guest checkout has no linked user until the webhook reconciles it —
      // fall back to the buyer fields so the row isn't an anonymous blank.
      const name = p.user?.name ?? p.buyerName;
      const email = p.user?.email ?? p.buyerEmail;
      return {
        at: p.updatedAt,
        user: displayName(name, email),
        avatar: initials(name, email),
        action: p.venueEvent
          ? `booked the venue for ${p.venueEvent.title}`
          : p.cohort
            ? `purchased a seat in ${p.cohort.title}`
            : "completed a purchase",
        time: "",
      };
    }),
  ];

  return items
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
    .map((i) => ({ ...i, time: relativeTime(i.at, now) }));
}
