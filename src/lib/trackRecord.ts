// src/lib/trackRecord.ts
//
// A learner's history in one shape, served to three audiences:
//   - the learner ("my track record")
//   - instructors, on a student
//   - staff, from the lead profile
//
// One query function, one permission function, so the three surfaces cannot
// drift into showing different things or enforcing different rules.

import prisma from "@/lib/prisma";
import { hasAnyRole, type RoleSource } from "@/lib/roles";
import { normalizeEmail } from "@/lib/onboarding-security";

export type TrackRecord = {
  user: { id: string; name: string | null; email: string; image: string | null };
  enrollments: Array<{
    cohortId: string;
    cohortTitle: string;
    status: string;
    source: string;
    joinedAt: string;
  }>;
  programEnrollments: Array<{ programId: string; programName: string; joinedAt: string }>;
  lessons: {
    completed: number;
    recent: Array<{ lessonTitle: string; cohortTitle: string | null; at: string }>;
  };
  quizzes: Array<{
    quizTitle: string;
    attempts: number;
    bestScore: number | null;
    status: string;
    lastAttemptAt: string;
  }>;
  assessments: Array<{
    title: string;
    totalScore: number | null;
    status: string;
    cohortTitle: string | null;
    submittedAt: string;
  }>;
  certificates: Array<{
    id: string;
    cohortTitle: string;
    pdfUrl: string | null;
    issuedAt: string;
    isRevoked: boolean;
  }>;
};

/**
 * Resolves the hub account behind a lead.
 *
 * `Contact.userId` (set by src/lib/leads/linking.ts) is authoritative when present;
 * otherwise we fall back to the normalized email, which is how every lead was
 * resolved before the link column existed and still covers unlinked rows.
 *
 * The email fallback is exact-match only: a lead who signed up with a different
 * address than they gave us legitimately has no match, and that is reported
 * honestly rather than guessed at — no fuzzy matching, no name-based fallback,
 * because attaching one person's learning history to another person's lead
 * record is far worse than showing "no linked account".
 */
export async function findUserIdForContact(contact: {
  userId: string | null;
  email: string;
}): Promise<string | null> {
  if (contact.userId) return contact.userId;

  const normalized = normalizeEmail(contact.email);
  if (!normalized) return null;
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Who may see a track record: the person themselves, or staff/instructors.
 *
 * v1 lets any INSTRUCTOR view any learner. That matches the flat role model in
 * roles.ts, which has no per-cohort ACL to scope against. Tightening this to
 * "instructors of a cohort this learner is enrolled in" is a documented
 * follow-up, not something to fake with a partial check here.
 */
export function canViewTrackRecord(
  viewer: RoleSource | undefined,
  viewerId: string | null,
  targetUserId: string
): boolean {
  if (viewerId && viewerId === targetUserId) return true;
  return hasAnyRole(viewer, ["ADMIN", "TEAM_MEMBER", "INSTRUCTOR"]);
}

const RECENT_LESSON_LIMIT = 10;

export async function getTrackRecord(userId: string): Promise<TrackRecord | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });
  if (!user) return null;

  const [
    enrollments,
    programEnrollments,
    lessonCount,
    recentLessons,
    quizSubmissions,
    assessmentSubmissions,
    certificates,
  ] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        cohortId: true,
        status: true,
        source: true,
        createdAt: true,
        cohort: { select: { title: true } },
      },
    }),
    prisma.programEnrollment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { programId: true, createdAt: true, program: { select: { name: true } } },
    }),
    prisma.lessonProgress.count({ where: { userId } }),
    prisma.lessonProgress.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_LESSON_LIMIT,
      select: {
        createdAt: true,
        lesson: { select: { name: true } },
        cohort: { select: { title: true } },
      },
    }),
    prisma.quizSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        quizId: true,
        totalScore: true,
        status: true,
        attemptNumber: true,
        createdAt: true,
        quiz: { select: { lesson: { select: { name: true } } } },
      },
    }),
    prisma.assessmentSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        totalScore: true,
        status: true,
        createdAt: true,
        assessment: { select: { name: true } },
        cohort: { select: { title: true } },
      },
    }),
    prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: "desc" },
      select: {
        id: true,
        pdfUrl: true,
        issuedAt: true,
        isRevoked: true,
        cohort: { select: { title: true } },
      },
    }),
  ]);

  // Quiz rows are per attempt; collapse to one line per quiz showing the best
  // score, since "scored 40% then 90%" should read as a 90%, not as two results.
  const quizByTitle = new Map<string, TrackRecord["quizzes"][number]>();
  for (const s of quizSubmissions) {
    const title = s.quiz?.lesson?.name ?? "Quiz";
    const existing = quizByTitle.get(title);
    if (!existing) {
      quizByTitle.set(title, {
        quizTitle: title,
        attempts: 1,
        bestScore: s.totalScore,
        status: s.status,
        lastAttemptAt: s.createdAt.toISOString(),
      });
      continue;
    }
    existing.attempts += 1;
    if (s.totalScore !== null && (existing.bestScore === null || s.totalScore > existing.bestScore)) {
      existing.bestScore = s.totalScore;
    }
  }

  return {
    user,
    enrollments: enrollments.map((e) => ({
      cohortId: e.cohortId,
      cohortTitle: e.cohort.title,
      status: e.status,
      source: e.source,
      joinedAt: e.createdAt.toISOString(),
    })),
    programEnrollments: programEnrollments.map((p) => ({
      programId: p.programId,
      programName: p.program.name,
      joinedAt: p.createdAt.toISOString(),
    })),
    lessons: {
      completed: lessonCount,
      recent: recentLessons.map((l) => ({
        lessonTitle: l.lesson.name,
        cohortTitle: l.cohort?.title ?? null,
        at: l.createdAt.toISOString(),
      })),
    },
    quizzes: [...quizByTitle.values()],
    assessments: assessmentSubmissions.map((a) => ({
      title: a.assessment.name,
      totalScore: a.totalScore,
      status: a.status,
      cohortTitle: a.cohort?.title ?? null,
      submittedAt: a.createdAt.toISOString(),
    })),
    certificates: certificates.map((c) => ({
      id: c.id,
      cohortTitle: c.cohort.title,
      pdfUrl: c.pdfUrl,
      issuedAt: c.issuedAt.toISOString(),
      isRevoked: c.isRevoked,
    })),
  };
}
