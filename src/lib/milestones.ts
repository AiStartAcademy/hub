import prisma from "@/lib/prisma";

const DEFAULT_MILESTONES = [
  {
    key: "first-conversation",
    title: "First conversation booked",
    description: "Schedule your first serious client discovery call.",
    order: 1,
  },
  {
    key: "first-pilot",
    title: "First pilot delivered",
    description: "Ship an initial paid or unpaid pilot engagement.",
    order: 2,
  },
  {
    key: "first-testimonial",
    title: "First testimonial",
    description: "Collect social proof from a real client outcome.",
    order: 3,
  },
  {
    key: "first-retainer",
    title: "First retainer signed",
    description: "Convert a client into an ongoing recurring engagement.",
    order: 4,
  },
  {
    key: "mrr-5k",
    title: "$5k/mo",
    description: "Reach five thousand dollars in monthly recurring revenue.",
    order: 5,
  },
  {
    key: "mrr-10k",
    title: "$10k/mo",
    description: "Reach ten thousand dollars in monthly recurring revenue.",
    order: 6,
  },
] as const;

export interface MilestoneLadderAchievement {
  id: string;
  achievedAt: Date;
  evidenceUrl: string | null;
  note: string | null;
  status: string;
  verifiedById: string | null;
}

export interface MilestoneLadderItem {
  id: string;
  key: string;
  title: string;
  description: string | null;
  order: number;
  achievement: MilestoneLadderAchievement | null;
}

export interface MilestoneLadderResult {
  items: MilestoneLadderItem[];
  verifiedCount: number;
}

export interface ReportMilestoneSuccess {
  ok: true;
  achievementId: string;
  milestoneId: string;
  milestoneKey: string;
  status: string;
}

export interface ReportMilestoneFailure {
  ok: false;
  error: string;
}

export type ReportMilestoneResult = ReportMilestoneSuccess | ReportMilestoneFailure;

function isValidEvidenceUrl(evidenceUrl: string): boolean {
  try {
    const parsed = new URL(evidenceUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

export async function ensureMilestones(): Promise<void> {
  await Promise.all(
    DEFAULT_MILESTONES.map((milestone) =>
      prisma.milestone.upsert({
        where: { key: milestone.key },
        create: {
          key: milestone.key,
          title: milestone.title,
          description: milestone.description,
          order: milestone.order,
        },
        update: {
          title: milestone.title,
          description: milestone.description,
          order: milestone.order,
        },
        select: { id: true },
      }),
    ),
  );
}

export async function getLadder(userId: string): Promise<MilestoneLadderResult> {
  const milestones = await prisma.milestone.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      key: true,
      title: true,
      description: true,
      order: true,
      achievements: {
        where: { userId },
        orderBy: { achievedAt: "desc" },
        take: 1,
        select: {
          id: true,
          achievedAt: true,
          evidenceUrl: true,
          note: true,
          status: true,
          verifiedById: true,
        },
      },
    },
  });

  const items: MilestoneLadderItem[] = milestones.map((milestone) => ({
    id: milestone.id,
    key: milestone.key,
    title: milestone.title,
    description: milestone.description,
    order: milestone.order,
    achievement: milestone.achievements[0] ?? null,
  }));

  const verifiedCount = items.filter((item) => item.achievement?.status === "verified").length;

  return {
    items,
    verifiedCount,
  };
}

export async function reportMilestone(
  userId: string,
  milestoneKey: string,
  evidenceUrl?: string,
  note?: string,
): Promise<ReportMilestoneResult> {
  if (evidenceUrl && !isValidEvidenceUrl(evidenceUrl)) {
    return {
      ok: false,
      error: "Evidence URL must be a valid http or https link.",
    };
  }

  const milestone = await prisma.milestone.findUnique({
    where: { key: milestoneKey },
    select: {
      id: true,
      key: true,
    },
  });

  if (!milestone) {
    throw new Error(`Milestone not found for key "${milestoneKey}" while reporting achievement.`);
  }

  const existingAchievement = await prisma.milestoneAchievement.findUnique({
    where: {
      userId_milestoneId: {
        userId,
        milestoneId: milestone.id,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  const preservedStatus = existingAchievement?.status === "verified" ? "verified" : "pending";
  const updateData: {
    status: string;
    evidenceUrl?: string | null;
    note?: string | null;
  } = {
    status: preservedStatus,
  };

  if (evidenceUrl !== undefined) {
    updateData.evidenceUrl = evidenceUrl;
  }

  if (note !== undefined) {
    updateData.note = note;
  }

  const achievement = await prisma.milestoneAchievement.upsert({
    where: {
      userId_milestoneId: {
        userId,
        milestoneId: milestone.id,
      },
    },
    update: updateData,
    create: {
      userId,
      milestoneId: milestone.id,
      evidenceUrl: evidenceUrl ?? null,
      note: note ?? null,
      status: "pending",
    },
    select: {
      id: true,
      milestoneId: true,
      status: true,
    },
  });

  return {
    ok: true,
    achievementId: achievement.id,
    milestoneId: achievement.milestoneId,
    milestoneKey: milestone.key,
    status: achievement.status,
  };
}
