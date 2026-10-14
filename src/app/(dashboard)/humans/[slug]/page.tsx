// src/app/(dashboard)/humans/[slug]/page.tsx
// Server SELECTOR for a human profile (View convention — docs/features/VIEWS.md).
// Resolves reachability first, then renders the mapped view:
//   mentor profile → MentorView (book a 1:1)
//   everyone else  → PublicProfileView (credibility / discovery)
//
// Reachability and view choice are deliberately two separate decisions. Visibility decides
// whether the page exists for this viewer at all (PRIVATE 404s for guests; admins and the
// owner may preview); `isMentor` decides which view renders. Collapsing them is how a "who is
// looking" tweak accidentally publishes a private profile — see the note in src/lib/audience.ts
// on why there is no profile audience resolver yet.
import { cache } from "react";
import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { notFound } from "next/navigation";
import { auth, canViewUserData } from "@/lib/auth";
import { findProfileBySlug } from "@/lib/humanProfile";
import { hasAcceleratorAccess } from "@/lib/programAccess";
import { isPubliclyReachable } from "@/lib/profileVisibility";
import MentorView from "./views/MentorView";
import PublicProfileView from "./views/PublicProfileView";

const SITE = brand.urls.hub;

type Params = { params: Promise<{ slug: string }> };

// Profiles change whenever an admin saves the editor — never prerender at build time
// (and the build stage has no DATABASE_URL, same reason sitemap.ts is dynamic).
export const dynamic = "force-dynamic";

/**
 * Next dedupes `fetch` across `generateMetadata` and the page render, but not Prisma — and
 * both need the same profile (each load pulls the row plus three relations). `cache()` makes
 * the second call free for the life of the request.
 */
const getProfile = cache(findProfileBySlug);

/** Plain-text, length-capped summary for meta description / JSON-LD. */
function plain(html: string | null, fallback: string): string {
  if (!html) return fallback;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 155) : fallback;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const human = await getProfile(slug);
  if (!human) return { title: "Profile", robots: { index: false, follow: false } };

  const session = await auth();
  const viewerId = (session?.user as { id?: string } | undefined)?.id;
  const staff = canViewUserData(session);
  const isOwner = Boolean(viewerId && viewerId === human.id);
  if (!isPubliclyReachable(human.visibility) && !staff && !isOwner) {
    return { title: "Profile", robots: { index: false, follow: false } };
  }

  const url = `/humans/${human.slug}`;
  const desc = human.headline
    ? `${human.headline} — ${brand.wordmark}.`
    : plain(human.bioHtml, `${human.name} at ${brand.wordmark}.`);

  // Only PUBLIC is indexable. UNLISTED is reachable by direct link but must stay out of
  // search results, and PRIVATE never renders for a guest at all.
  const indexable = human.visibility === "PUBLIC";

  return {
    title: human.name,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      title: `${human.name} — ${brand.wordmark}`,
      description: desc,
      url,
      type: "profile",
      ...(human.image ? { images: [human.image] } : {}),
    },
    robots: { index: indexable, follow: indexable },
  };
}

export default async function HumanProfilePage({ params }: Params) {
  const { slug } = await params;
  const human = await getProfile(slug);
  if (!human) notFound();

  const session = await auth();
  const viewerId = (session?.user as { id?: string } | undefined)?.id;
  const staff = canViewUserData(session);
  const isOwner = Boolean(viewerId && viewerId === human.id);

  // Reachability gate. A PRIVATE profile exists only for staff and its owner; to
  // everyone else the page genuinely does not exist.
  if (!isPubliclyReachable(human.visibility) && !staff && !isOwner) notFound();

  // Staff and owners keep the real CTA for preview parity; everyone else must hold an
  // active Accelerator membership. Non-mentor profiles skip this query entirely.
  const canBookMentor = human.isMentor
    ? staff || isOwner || (await hasAcceleratorAccess(viewerId))
    : false;

  // Staff/owner looking at a not-yet-public profile get told why nobody else sees it —
  // the single most common "why isn't my mentor showing up" support question.
  const preview =
    human.visibility !== "PUBLIC" && (staff || isOwner) ? (
      <div className="hp-wrap">
        <div className="hp-inner" style={{ paddingBottom: 0 }}>
          <p className="hp-note">
            <b>Preview — {human.visibility.toLowerCase()}.</b>
            {human.visibility === "PRIVATE"
              ? " Only you and admins can see this page, and it isn't on any roster."
              : " Reachable by direct link, but not listed on a roster and not indexed."}
            {staff && <a href="/admin/users"> Change visibility in Admin → Users →</a>}
          </p>
        </div>
      </div>
    ) : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: human.name,
    ...(human.headline ? { jobTitle: human.headline } : {}),
    ...(human.image ? { image: human.image } : {}),
    ...(human.location ? { address: { "@type": "PostalAddress", addressLocality: human.location } } : {}),
    ...(human.expertiseTags.length ? { knowsAbout: human.expertiseTags } : {}),
    ...(human.languages.length ? { knowsLanguage: human.languages } : {}),
    ...(human.socialLinks.length ? { sameAs: human.socialLinks.map((l) => l.url) } : {}),
    description: plain(human.bioHtml, human.headline || human.name),
    worksFor: { "@type": "Organization", name: brand.wordmark, url: brand.urls.site },
    url: `${SITE}/humans/${human.slug}`,
  };

  return (
    <>
      {/* JSON-LD only for pages search engines are allowed to have. */}
      {human.visibility === "PUBLIC" && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {preview}
      {/* The view is chosen by the profile's capability flag, not by who is looking:
          mentor profiles keep their dedicated rail for everybody, even when the CTA itself
          soft-gates to Accelerator/staff/owner viewers. */}
      {human.isMentor ? (
        <MentorView human={human} canBookMentor={canBookMentor} />
      ) : (
        <PublicProfileView human={human} />
      )}
    </>
  );
}
