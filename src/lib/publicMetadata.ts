import type { Metadata } from "next";

import { brand } from "@/config/brand";

export const cohortsMetadata = {
  title: "Cohorts",
  description: `Upcoming live cohorts from ${brand.name} — in person and online. Browse dates, tickets, and registration.`,
  alternates: { canonical: "/cohorts" },
  openGraph: {
    title: `Cohorts — ${brand.name}`,
    description: `Live cohorts from ${brand.name}, available in person and online. Browse upcoming dates and register.`,
    url: "/cohorts",
    type: "website",
  },
  robots: { index: true, follow: true },
} satisfies Metadata;

export const membershipMetadata = {
  title: "Membership",
  description: `Membership at ${brand.name}: stay current with new recordings and materials, join ongoing Q&A, and build with experienced mentors.`,
  alternates: { canonical: `${brand.urls.hub}/membership` },
  openGraph: {
    title: `Membership — ${brand.name}`,
    description: `Stay current with new learning materials and build with the mentor community at ${brand.name}.`,
    url: `${brand.urls.hub}/membership`,
    images: ["/api/media/media/marketing/membership/previews/hero-workshop.jpg"],
  },
} satisfies Metadata;
