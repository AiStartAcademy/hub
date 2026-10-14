import prisma from "@/lib/prisma";

export interface UserPodMember {
  role: string;
  joinedAt: Date;
  user: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

export interface UserPodCoach {
  id: string;
  name: string | null;
  image: string | null;
}

export interface UserPodResult {
  id: string;
  name: string;
  slug: string;
  status: string;
  capacity: number;
  cohortId: string | null;
  coach: UserPodCoach | null;
  members: UserPodMember[];
}

export async function getUserPod(userId: string): Promise<UserPodResult | null> {
  const podMembership = await prisma.podMember.findFirst({
    where: {
      userId,
      leftAt: null,
    },
    orderBy: {
      joinedAt: "desc",
    },
    select: {
      pod: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          capacity: true,
          cohortId: true,
          coach: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          members: {
            where: {
              leftAt: null,
            },
            orderBy: {
              joinedAt: "asc",
            },
            select: {
              role: true,
              joinedAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!podMembership?.pod) {
    return null;
  }

  return podMembership.pod;
}
