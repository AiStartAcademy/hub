import { Prisma } from "@/generated/client";
import prisma from "@/lib/prisma";

export class DuplicateGroupMembershipError extends Error {
  constructor() {
    super("User is already in this group");
    this.name = "DuplicateGroupMembershipError";
  }
}

export async function addUserToGroup(
  userId: string,
  groupId: string,
  cohortId: string
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const member = await tx.groupMember.create({
        data: { groupId, userId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              role: true,
            },
          },
        },
      });

      await tx.enrollment.upsert({
        where: { userId_cohortId: { userId, cohortId } },
        create: { userId, cohortId },
        update: {},
      });

      return member;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicateGroupMembershipError();
    }
    throw error;
  }
}
