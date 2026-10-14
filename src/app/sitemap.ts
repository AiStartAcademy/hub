import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";
import { listIndexableProfileSlugs } from "@/lib/humanProfile";
import prisma from "@/lib/prisma";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || brand.urls.hub;
const PUBLIC_STATUSES = ["ENROLLMENT", "IN_PROGRESS", "COMPLETE"];

// Render per-request, never at build time. This route queries the DB for cohort
// URLs, and the Docker/CI build stage has no DATABASE_URL — prerendering it there
// crashes the build when `src/lib/prisma.ts` eagerly constructs PrismaClient.
// Serving it dynamically also means newly published cohorts appear immediately.
export const dynamic = "force-dynamic";

// Only publicly indexable pages belong here. The authenticated app and
// private forms are intentionally excluded (see robots.ts).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/courses`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/self-paced`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/membership`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/assets`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/calendar`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/cohorts`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/mentors`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/instructors`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Per-cohort clean URLs for publicly visible cohorts.
  let cohortRoutes: MetadataRoute.Sitemap = [];
  try {
    const cohorts = await prisma.cohort.findMany({
      where: { status: { in: PUBLIC_STATUSES } },
      select: { id: true, slug: true, updatedAt: true },
    });
    cohortRoutes = cohorts.map((c) => ({
      url: `${SITE_URL}/cohorts/${c.slug || c.id}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  } catch {
    // DB unavailable (e.g. at build time) — ship the static routes rather than fail.
  }

  let venueEventRoutes: MetadataRoute.Sitemap = [];
  try {
    const venueEvents = await prisma.venueEvent.findMany({
      where: { status: "APPROVED" },
      select: { slug: true, updatedAt: true },
    });
    venueEventRoutes = venueEvents.flatMap((event) => {
      if (!event.slug) {
        return [];
      }

      return [
        {
          url: `${SITE_URL}/events/${event.slug}`,
          lastModified: event.updatedAt,
          changeFrequency: "weekly",
          priority: 0.7,
        },
      ];
    });
  } catch {
    // DB unavailable (e.g. at build time) — ship the static routes rather than fail.
  }

  let profileRoutes: MetadataRoute.Sitemap = [];
  try {
    const profiles = await listIndexableProfileSlugs();
    profileRoutes = profiles.map((profile) => ({
      url: `${SITE_URL}/humans/${profile.slug}`,
      lastModified: profile.updatedAt,
      changeFrequency: "monthly",
      priority: 0.7,
    }));
  } catch {
    // DB unavailable (e.g. at build time) — ship the static routes rather than fail.
  }

  return [...staticRoutes, ...cohortRoutes, ...venueEventRoutes, ...profileRoutes];
}
