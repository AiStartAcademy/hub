// src/app/(dashboard)/instructors/page.tsx
// Public INSTRUCTORS roster — the single visible roster (docs/features/HUMANS.md).
// The Mentors sidebar tab is hidden; instructors with `isMentor` get a Mentor badge
// and the booking affordance here (`showBooking` + HumanCard's own isMentor gate).
import type { Metadata } from "next";
import { brand } from "@/config/brand";
import HumanRoster from "@/components/humans/HumanRoster";
import { listInstructors } from "@/lib/humanProfile";

const SITE = brand.urls.hub;
const DESC =
  `Meet the instructors teaching ${brand.name} cohorts in ${brand.address.city} — AI automation, agents, Claude Code, n8n, voice agents and AI security.`;

export const metadata: Metadata = {
  title: "Instructors",
  description: DESC,
  alternates: { canonical: "/instructors" },
  openGraph: { title: `Instructors — ${brand.wordmark}`, description: DESC, url: "/instructors", type: "website" },
  robots: { index: true, follow: true },
};

export const dynamic = "force-dynamic";

export default async function InstructorsPage() {
  const instructors = await listInstructors();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${brand.wordmark} instructors`,
    url: `${SITE}/instructors`,
    itemListElement: instructors.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/humans/${p.slug}`,
      name: p.name,
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HumanRoster
        eyebrow="Who teaches"
        title="Instructors"
        intro={`The people in the room. Every ${brand.wordmark} cohort is taught by operators who run this work commercially — agencies, security practices, production AI systems. Instructors with a Mentor badge also take 1:1 sessions — book time directly from their profile.`}
        humans={instructors}
        showBooking
        emptyTitle="Instructor profiles are going live shortly"
        emptyBody="We're publishing instructor profiles now. In the meantime, every cohort page lists who is teaching it."
      />
    </>
  );
}
