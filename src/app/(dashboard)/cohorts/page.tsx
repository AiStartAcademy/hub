// src/app/(dashboard)/cohorts/page.tsx
// Public-facing cohorts page (Luma-style) — overrides the dashboard noindex default,
// mirrors the /courses public pattern. Admins/team see the management UI; everyone
// else (incl. logged-out prospects) sees the public list rendered from server data.
import { brand } from "@/config/brand";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import CohortsManage from "./CohortsManage";
import CohortsPublic from "./CohortsPublic";
import { hasAnyRole, MANAGE_ROLES } from "@/lib/roles";
import {
  buildPublicCohortListing,
  type PublicCohort,
} from "@/lib/publicCohorts";
import { loadPublicCohortRows } from "@/lib/publicCohorts.server";
import { cohortsMetadata } from "@/lib/publicMetadata";

export const metadata = cohortsMetadata;

async function getPublicCohorts(userId?: string): Promise<PublicCohort[]> {
  const now = new Date();
  const rows = await loadPublicCohortRows(now);

  // Cohorts the viewer already belongs to (Enrollment or GroupMember) — the list
  // swaps the Register CTA for an "Enrolled" link on these.
  const enrolledCohortIds = new Set<string>();
  if (userId) {
    const [enrollments, memberships] = await Promise.all([
      prisma.enrollment.findMany({ where: { userId }, select: { cohortId: true } }),
      prisma.groupMember.findMany({
        where: { userId },
        select: { group: { select: { cohortId: true } } },
      }),
    ]);
    enrollments.forEach((e) => enrolledCohortIds.add(e.cohortId));
    memberships.forEach((m) => enrolledCohortIds.add(m.group.cohortId));
  }

  return rows.map((cohort) =>
    buildPublicCohortListing(cohort, enrolledCohortIds.has(cohort.id), now)
  );
}

export default async function CohortsPage() {
  const session = await auth();
  if (hasAnyRole(session?.user, MANAGE_ROLES)) {
    return <CohortsManage />;
  }

  const userId = (session?.user as { id?: string } | undefined)?.id;
  const cohorts = await getPublicCohorts(userId);

  // Event JSON-LD for the upcoming, enrolling cohorts.
  const events = cohorts
    .filter((c) => c.status === "ENROLLMENT" && c.startDate)
    .map((c) => ({
      "@type": "Event",
      name: `${c.title} — ${c.durationLabel ?? ""}`.trim(),
      startDate: c.startDate,
      endDate: c.endDate ?? undefined,
      eventAttendanceMode:
        c.deliveryMode === "INPERSON"
          ? "https://schema.org/OfflineEventAttendanceMode"
          : c.deliveryMode === "HYBRID"
            ? "https://schema.org/MixedEventAttendanceMode"
            : "https://schema.org/OnlineEventAttendanceMode",
      location: c.location
        ? { "@type": "Place", name: c.location }
        : { "@type": "VirtualLocation", url: `${brand.urls.hub}/cohorts` },
      organizer: { "@type": "Organization", name: brand.wordmark, url: brand.urls.site },
      ...(c.fromPrice
        ? { offers: { "@type": "Offer", price: c.fromPrice, priceCurrency: "USD", url: `${brand.urls.hub}/cohorts/${c.slug || c.id}` } }
        : {}),
      url: `${brand.urls.hub}/cohorts/${c.slug || c.id}`,
    }));
  const jsonLd = { "@context": "https://schema.org", "@graph": events };

  return (
    <>
      {events.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <CohortsPublic cohorts={cohorts} />
    </>
  );
}
