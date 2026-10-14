// src/lib/memberProgress.ts
//
// Staff-facing course-progress reads for the members area. LessonProgress rows
// are written when a student completes a lesson; until now the only consumer
// was the student's own dashboard stats. These helpers aggregate them per
// member so staff can see where someone is and where they stalled.

import prisma from "@/lib/prisma";

export interface ProgramProgress {
  programId: string;
  programName: string;
  lessonsTotal: number;
  lessonsCompleted: number;
  /** 0-100, rounded. */
  percent: number;
  lastActivityAt: Date | null;
}

export interface MemberProgressSummary {
  programs: ProgramProgress[];
  lessonsCompletedTotal: number;
  lastActivityAt: Date | null;
}

/**
 * Per-program progress for one user. Only programs where the user has at least
 * one completed lesson are returned — "never started" programs are the
 * complement and the caller can render them from the program catalog if needed.
 */
export async function getMemberProgress(userId: string): Promise<MemberProgressSummary> {
  const rows = await prisma.lessonProgress.findMany({
    where: { userId },
    select: {
      createdAt: true,
      lesson: {
        select: {
          id: true,
          module: { select: { program: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const byProgram = new Map<
    string,
    { name: string; completed: Set<string>; last: Date }
  >();
  for (const row of rows) {
    const program = row.lesson.module.program;
    const entry = byProgram.get(program.id) ?? {
      name: program.name,
      completed: new Set<string>(),
      last: row.createdAt,
    };
    entry.completed.add(row.lesson.id);
    if (row.createdAt > entry.last) entry.last = row.createdAt;
    byProgram.set(program.id, entry);
  }

  const totals = await prisma.lesson.groupBy({
    by: ["moduleId"],
    _count: { id: true },
    where: {
      module: { programId: { in: [...byProgram.keys()] } },
    },
  });
  // moduleId → programId mapping for the totals
  const modules = await prisma.module.findMany({
    where: { programId: { in: [...byProgram.keys()] } },
    select: { id: true, programId: true },
  });
  const moduleToProgram = new Map(modules.map((m) => [m.id, m.programId]));
  const totalByProgram = new Map<string, number>();
  for (const t of totals) {
    const programId = moduleToProgram.get(t.moduleId);
    if (!programId) continue;
    totalByProgram.set(programId, (totalByProgram.get(programId) ?? 0) + t._count.id);
  }

  const programs: ProgramProgress[] = [...byProgram.entries()]
    .map(([programId, entry]) => {
      const total = totalByProgram.get(programId) ?? 0;
      return {
        programId,
        programName: entry.name,
        lessonsTotal: total,
        lessonsCompleted: entry.completed.size,
        percent: total > 0 ? Math.round((entry.completed.size / total) * 100) : 0,
        lastActivityAt: entry.last,
      };
    })
    .sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0));

  return {
    programs,
    lessonsCompletedTotal: rows.length,
    lastActivityAt: rows[0]?.createdAt ?? null,
  };
}

export interface MemberActivityRow {
  userId: string;
  lessonsCompleted: number;
  lastActivityAt: Date | null;
}

/** Bulk lesson-activity stats for the members list — one query, no N+1. */
export async function getMembersActivity(userIds: string[]): Promise<Map<string, MemberActivityRow>> {
  if (userIds.length === 0) return new Map();
  const grouped = await prisma.lessonProgress.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _count: { id: true },
    _max: { createdAt: true },
  });
  return new Map(
    grouped.map((g) => [
      g.userId,
      {
        userId: g.userId,
        lessonsCompleted: g._count.id,
        lastActivityAt: g._max.createdAt,
      },
    ])
  );
}
