// src/lib/humanProfile.ts
//
// The public projection of a human profile, plus the two roster queries behind
// /mentors and /instructors. See docs/features/HUMANS.md.
//
// Everything a guest can see about a person passes through here. That is the point:
// `User` carries email, password hash, Stripe and Rocket.Chat ids, and the attribution
// blob, so a public page must never hand a Prisma `User` straight to a view. The
// `select` clauses below are the allowlist, and `toPublicProfile()` is the only
// constructor of the shape views receive.

import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/roles";
import { sanitizeDescription } from "@/lib/sanitize";

/** Roster card shape — what `<HumanCard>` needs, and nothing more. */
export interface HumanCardData {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  headline: string | null;
  location: string | null;
  isMentor: boolean;
  expertiseTags: string[];
  /** Cohorts this person has taught — derived, never hand-entered. */
  cohortsTaught: number;
}

/** Full public profile shape for `/humans/{slug}`. */
export interface PublicHumanProfile extends HumanCardData {
  /** Sanitized rich-text bio. Safe for dangerouslySetInnerHTML; nothing else here is. */
  bioHtml: string | null;
  timezone: string;
  languages: string[];
  socialLinks: SocialLink[];
  portfolio: { id: string; title: string; url: string; thumbnail: string | null; outcome: string | null }[];
  videos: { id: string; title: string | null; url: string }[];
  testimonials: { id: string; quote: string; authorName: string; authorRole: string | null; authorAvatar: string | null }[];
  /** PRIVATE | PUBLIC | UNLISTED — the view uses it only to render a staff-preview banner. */
  visibility: string;
}

export interface SocialLink {
  /** linkedin | youtube | x | site — the four keys the admin editor writes. */
  key: string;
  label: string;
  url: string;
}

const SOCIAL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
  twitter: "X",
  site: "Website",
  website: "Website",
  github: "GitHub",
};

/**
 * Only http(s) survives. `socialLinks` is admin-entered free text stored as JSON, and it
 * lands in an `href` on a world-readable page — a `javascript:` or `data:` value there is
 * stored XSS. Parsing with `new URL()` rather than a regex also throws out the
 * whitespace/unicode tricks that defeat prefix checks.
 */
function safeHttpUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Like safeHttpUrl, but also accepts our own root-relative proxy paths. `image`,
 * portfolio `thumbnail`, and testimonial `authorAvatar` are written via
 * `getProxyUrl()` (src/lib/mediaUtils.ts), which returns a relative "/media/..."
 * path unless the stored key is already an absolute http(s) URL — `new URL()`
 * throws on that relative form with no base, so `safeHttpUrl` silently dropped
 * every such image. A single leading "/" (not "//", which is protocol-relative
 * and could point off-site) is the only relative shape we trust here.
 */
function safeImageUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return safeHttpUrl(s);
}

/** Parse the `socialLinks` JSON blob into rendered-link candidates, dropping anything unsafe. */
export function parseSocialLinks(raw: string | null): SocialLink[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Hand-edited or half-saved JSON must not blow up server rendering of a public page.
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  return Object.entries(parsed as Record<string, unknown>)
    .map(([key, value]) => {
      const url = safeHttpUrl(value);
      if (!url) return null;
      const k = key.toLowerCase();
      return { key: k, label: SOCIAL_LABELS[k] ?? key, url };
    })
    .filter((l): l is SocialLink => l !== null);
}

/** Split a comma-separated field (`expertiseTags`, `languages`) into trimmed values. */
export function splitList(raw: string | null): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Columns a roster card is built from. Anything absent here can't reach a guest.
 * `role`/`roles` are the exception: they are read only by the `listInstructors`
 * post-filter and dropped in `toCard`, because the DB can't do exact membership on a
 * JSON *string* column. Keep them out of `HumanCardData` — a roster must not publish
 * who holds which role.
 */
const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  image: true,
  role: true,
  roles: true,
  headline: true,
  location: true,
  isMentor: true,
  expertiseTags: true,
  _count: { select: { taughtCohorts: true } },
} as const;

/** Card columns plus the profile-page body. Still an allowlist — no email, no password. */
const PROFILE_SELECT = {
  ...CARD_SELECT,
  bio: true,
  timezone: true,
  languages: true,
  socialLinks: true,
  profileVisibility: true,
  portfolioItems: {
    orderBy: { order: "asc" },
    select: { id: true, title: true, url: true, thumbnail: true, outcome: true },
  },
  profileVideos: {
    orderBy: { order: "asc" },
    select: { id: true, title: true, url: true },
  },
  testimonials: {
    orderBy: { order: "asc" },
    select: { id: true, quote: true, authorName: true, authorRole: true, authorAvatar: true },
  },
} as const;

type CardRow = {
  id: string;
  slug: string | null;
  name: string | null;
  image: string | null;
  role: string | null;
  roles: string | null;
  headline: string | null;
  location: string | null;
  isMentor: boolean;
  expertiseTags: string | null;
  _count: { taughtCohorts: number };
};

type PortfolioRow = {
  id: string;
  title: string;
  url: string;
  thumbnail: string | null;
  outcome: string | null;
};

type VideoRow = {
  id: string;
  title: string | null;
  url: string;
};

type TestimonialRow = {
  id: string;
  quote: string;
  authorName: string;
  authorRole: string | null;
  authorAvatar: string | null;
};

type ProfileRow = CardRow & {
  bio: string | null;
  timezone: string;
  languages: string | null;
  socialLinks: string | null;
  profileVisibility: string;
  portfolioItems: PortfolioRow[];
  profileVideos: VideoRow[];
  testimonials: TestimonialRow[];
};

function toCard(row: CardRow): HumanCardData {
  return {
    id: row.id,
    // Roster queries require a non-null slug, so this fallback only guards the type.
    slug: row.slug ?? row.id,
    name: row.name ?? brand.wordmark,
    image: safeImageUrl(row.image),
    headline: row.headline,
    location: row.location,
    isMentor: row.isMentor,
    expertiseTags: splitList(row.expertiseTags),
    cohortsTaught: row._count.taughtCohorts,
  };
}

function sanitizePortfolio(items: PortfolioRow[]): PublicHumanProfile["portfolio"] {
  return items.flatMap((item) => {
    const url = safeHttpUrl(item.url);
    if (!url) return [];
    return [{ ...item, url, thumbnail: safeImageUrl(item.thumbnail) }];
  });
}

function sanitizeVideos(items: VideoRow[]): PublicHumanProfile["videos"] {
  return items.flatMap((item) => {
    const url = safeHttpUrl(item.url);
    if (!url) return [];
    return [{ ...item, url }];
  });
}

function sanitizeTestimonials(items: TestimonialRow[]): PublicHumanProfile["testimonials"] {
  return items.map((item) => ({
    ...item,
    authorAvatar: safeImageUrl(item.authorAvatar),
  }));
}

/**
 * A person only appears on a roster when they are PUBLIC *and* have a slug. UNLISTED is
 * reachable by direct link but deliberately unlisted, and a slugless row would render a
 * card linking to a 404.
 */
const LISTED = { profileVisibility: "PUBLIC", slug: { not: null } } as const;

/** `/mentors` — `isMentor` is a capability flag, orthogonal to `role`. */
export async function listMentors(): Promise<HumanCardData[]> {
  const rows = await prisma.user.findMany({
    where: { ...LISTED, isMentor: true },
    select: CARD_SELECT,
    orderBy: [{ name: "asc" }],
  });
  return rows.map(toCard);
}

/**
 * `/instructors` — matches on both the legacy single `role` column and the newer
 * multi-role `roles` JSON array. `src/lib/roles.ts` makes `roles` the source of truth
 * once populated, but rows predating multi-role only carry `role`; filtering on one
 * alone silently drops half the roster. `contains` is the available predicate because
 * `roles` is a JSON *string* column, so it's paired with an exact-match check in code.
 */
export async function listInstructors(): Promise<HumanCardData[]> {
  const rows = await prisma.user.findMany({
    where: {
      ...LISTED,
      OR: [{ role: "INSTRUCTOR" }, { roles: { contains: "INSTRUCTOR" } }],
    },
    select: CARD_SELECT,
    orderBy: [{ name: "asc" }],
  });
  return rows.filter((row) => hasRole(row, "INSTRUCTOR")).map(toCard);
}

/**
 * Load one profile by slug. Returns the row's visibility so the caller can decide
 * reachability — this function deliberately does not 404 on its own, because "can an
 * admin preview a PRIVATE profile" is a route-level authorization question.
 */
export async function findProfileBySlug(slug: string): Promise<PublicHumanProfile | null> {
  const row: ProfileRow | null = await prisma.user.findFirst({
    where: { slug },
    select: PROFILE_SELECT,
  });
  if (!row) return null;

  return {
    ...toCard(row),
    bioHtml: sanitizeDescription(row.bio),
    timezone: row.timezone,
    languages: splitList(row.languages),
    socialLinks: parseSocialLinks(row.socialLinks),
    portfolio: sanitizePortfolio(row.portfolioItems),
    videos: sanitizeVideos(row.profileVideos),
    testimonials: sanitizeTestimonials(row.testimonials),
    visibility: row.profileVisibility,
  };
}

/** Slugs of PUBLIC profiles, for `sitemap.ts`. UNLISTED is excluded by design. */
export async function listIndexableProfileSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  const rows = await prisma.user.findMany({
    where: LISTED,
    select: { slug: true, updatedAt: true },
  });
  return rows.flatMap((r) => (r.slug ? [{ slug: r.slug, updatedAt: r.updatedAt }] : []));
}
