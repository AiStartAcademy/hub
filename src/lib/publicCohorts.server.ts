import prisma from "@/lib/prisma";
import { groupSeatInclude } from "@/lib/seats";
import {
  sortPublicCohortRows,
  type PublicCohortRow,
} from "@/lib/publicCohorts";
import { PUBLIC_COHORT_STATUSES } from "@/lib/publicCohortVisibility";

/**
 * Shared, explicitly allowlisted read for the public cohorts page and feed.
 * Passing `now` keeps pending-seat holds consistent with the generated payload.
 */
export async function loadPublicCohortRows(now: Date): Promise<PublicCohortRow[]> {
  const rows = await prisma.cohort.findMany({
    where: { status: { in: [...PUBLIC_COHORT_STATUSES] } },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      cover: true,
      status: true,
      deliveryMode: true,
      location: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      timezone: true,
      tools: true,
      certificate: true,
      leadMagnet: true,
      leadMagnetCta: true,
      groups: {
        orderBy: { price: "asc" },
        select: {
          id: true,
          name: true,
          inPerson: true,
          price: true,
          seats: true,
          ...groupSeatInclude(now),
        },
      },
      instructors: {
        select: {
          id: true,
          name: true,
          image: true,
          slug: true,
          profileVisibility: true,
        },
      },
      sessions: {
        orderBy: { order: "asc" },
        select: { title: true, startTime: true, timezone: true },
      },
    },
  });

  return sortPublicCohortRows(rows);
}
