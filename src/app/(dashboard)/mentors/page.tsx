// src/app/(dashboard)/mentors/page.tsx
// Public MENTORS roster — a filtered view over the one profile per human
// (docs/features/HUMANS.md). Cards link into /humans/{slug}; mentor cards get the
// booking affordance. Thin server component: query → shared roster chrome.
import type { Metadata } from "next";
import { brand } from "@/config/brand";
import HumanRoster from "@/components/humans/HumanRoster";
import { listMentors } from "@/lib/humanProfile";

const SITE = brand.urls.hub;
const DESC =
  `Work 1:1 with ${brand.name} mentors — practitioners who deploy AI automation, agents and secure AI systems for real businesses.`;

// The (dashboard) layout is noindex by default (it's an authenticated app). This page is
// public, so it opts back in — same override the public cohort routes rely on.
export const metadata: Metadata = {
  title: "Mentors",
  description: DESC,
  alternates: { canonical: "/mentors" },
  openGraph: { title: `Mentors — ${brand.wordmark}`, description: DESC, url: "/mentors", type: "website" },
  robots: { index: true, follow: true },
};

// The roster reflects whatever is published right now — never prerender it at build time.
export const dynamic = "force-dynamic";

export default async function MentorsPage() {
  const mentors = await listMentors();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${brand.wordmark} mentors`,
    url: `${SITE}/mentors`,
    itemListElement: mentors.map((m, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/humans/${m.slug}`,
      name: m.name,
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HumanRoster
        eyebrow="1:1 Mentorship"
        title="Mentors"
        intro="Practitioners, not lecturers. Our mentors build and ship AI automation for real businesses — book time to work through your own build, pipeline or agency launch."
        humans={mentors}
        showBooking
        emptyTitle="Mentor profiles are going live shortly"
        emptyBody="We're publishing the mentor roster now. If you want 1:1 time before it's up, email us and we'll match you with the right person."
      />
    </>
  );
}
