// src/app/(dashboard)/courses/page.tsx

import type { Metadata } from "next";
import { brand } from "@/config/brand";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import prisma from "@/lib/prisma";

// Public-facing — override the dashboard group's noindex default.
export const metadata: Metadata = {
  title: "Courses",
  description:
    `Browse ${brand.name} courses — hands-on, cohort-based AI automation training for founders, operators, and professionals.`,
  alternates: { canonical: "/courses" },
  openGraph: {
    title: `Courses — ${brand.name}`,
    description:
      "Hands-on, cohort-based AI automation training for founders, operators, and professionals.",
    url: "/courses",
    type: "website",
  },
  robots: { index: true, follow: true },
};
import { auth } from "@/lib/auth";
import { CourseCreateButton } from "./components/CourseCreateButton";
import { CourseListClient } from "./components/CourseListClient";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";

export default async function CoursesPage() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  const canManage = hasAnyRole(session?.user, MANAGE_ROLES);

  // Collect all program IDs accessible to the student via cohort/direct grant
  let accessibleProgramIds: string[] = [];

  if (!canManage) {
    const userCohorts = userId
      ? await prisma.cohort.findMany({
          where: {
            OR: [
              { enrollments: { some: { userId } } },
              { groups: { some: { members: { some: { userId } } } } },
            ],
          },
          select: {
            rawProgramId: true,
            programs: { select: { id: true } },
          },
        })
      : [];

    const accessibleSet = new Set<string>();
    for (const cohort of userCohorts) {
      if (cohort.rawProgramId) accessibleSet.add(cohort.rawProgramId);
      for (const prog of cohort.programs) accessibleSet.add(prog.id);
    }

    if (userId) {
      const directAccess = await prisma.programAccess.findMany({
        where: { userId },
        select: { programId: true },
      });
      for (const da of directAccess) accessibleSet.add(da.programId);
    }

    accessibleProgramIds = Array.from(accessibleSet);
  }

  // Show all open-status courses to everyone — labels handle access distinction.
  // Draft/raw/archived are hidden unless the user is enrolled.
  const studentWhere = {
    OR: [
      // Any open course is visible (public, auth, cohort, direct — all modes)
      { status: "open" },
      // Enrolled users also see their raw/draft cohort courses
      ...(accessibleProgramIds.length > 0
        ? [{ id: { in: accessibleProgramIds } }]
        : []),
    ],
  };

  const allPrograms = await prisma.program.findMany({
    where: canManage ? undefined : studentWhere,
    include: {
      rawCohort: { select: { title: true } },
      cohorts: { select: { title: true } },
      modules: {
        include: {
          lessons: { select: { duration: true } },
          assessments: { select: { id: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const lockedRows = await prisma.$queryRaw<{ id: string; locked: number }[]>`
    SELECT "id", "locked" FROM "Program"
  `;
  const lockedMap = new Map(lockedRows.map((r) => [r.id, r.locked === 1]));

  const allProgramsWithLocked = allPrograms.map((p) => ({
    ...p,
    locked: lockedMap.get(p.id) ?? false,
  }));

  return (
    <div className="flex flex-col h-full w-full">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 flex items-center px-4 md:px-8 flex-shrink-0 shadow-sm z-10">
        <MobileMenuButton />
        <div className="flex-1 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Courses
          </h1>
          {canManage && <CourseCreateButton />}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 animate-fade-in">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Learn AI by building, not watching
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-500 dark:text-slate-400 max-w-3xl">
              These are the courses behind {brand.name}&apos;s AI automation training
              for founders, professionals, and students. Each course is built from real
              cohort sessions: recordings, workbooks, and exercises you can follow at your
              own pace.
            </p>
            <p className="mt-3 text-sm sm:text-base text-slate-500 dark:text-slate-400 max-w-3xl">
              Cohorts give you live access — in person in {brand.address.city} or over Zoom — with
              instructors walking you through the theory and the setup, so you leave with
              working systems, not notes. Free courses are open to everyone; cohort courses
              unlock when you join a bootcamp.{" "}
              <Link
                href="/cohorts"
                className="font-semibold text-primary hover:underline"
              >
                Check upcoming cohorts →
              </Link>
            </p>
          </div>
          <CourseListClient
            initialPrograms={allProgramsWithLocked}
            canManage={canManage}
            isAuthenticated={!!userId}
            accessibleProgramIds={accessibleProgramIds}
          />
        </div>
      </div>
    </div>
  );
}
