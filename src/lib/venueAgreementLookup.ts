import prisma from "@/lib/prisma";

export async function findLatestAgreementTokenForEvent(
  venueEventId: string,
): Promise<string | null> {
  const agreement = await prisma.venueAgreement.findFirst({
    where: {
      venueEventId,
      status: {
        not: "VOID",
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      token: true,
    },
  });

  return agreement?.token ?? null;
}
