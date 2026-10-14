import prisma from "@/lib/prisma";

// Tunable: how long after purchase the weekly check-in calls stay included.
export const COURSE_CALL_WINDOW_DAYS = 90;

export async function hasCourseCallAccess(userId: string): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const cutoff = new Date(
    Date.now() - COURSE_CALL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const access = await prisma.programAccess.findFirst({
    where: {
      userId,
      createdAt: {
        gte: cutoff,
      },
      program: {
        includesWeeklyCalls: true,
      },
    },
    select: {
      id: true,
    },
  });

  return access !== null;
}
