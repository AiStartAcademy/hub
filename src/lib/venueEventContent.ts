/**
 * Parsers and serializers for the JSON-string content columns on VenueEvent
 * (gallery, agenda, hosts, pricingTiers, faq).
 *
 * SQLite has no scalar lists, so these are stored as JSON strings — the same
 * convention ContentPage already uses. Every reader and writer must go through
 * this module: the parsers never throw and drop anything malformed, so a
 * hand-edited row degrades to an empty section instead of crashing a public
 * page or rendering `[object Object]`.
 *
 * The `serialize*` functions are the write-side counterpart — they accept the
 * loose shapes an admin form or an MCP payload produces, run them through the
 * same normalization, and return a canonical JSON string (or null when empty)
 * so the DB only ever holds validated content.
 */

export type GalleryImage = {
  url: string;
  alt?: string;
  caption?: string;
};

export type AgendaItem = {
  /** YYYY-MM-DD — groups items into days on a multi-day event. */
  date?: string;
  /** Optional day label override, e.g. "Day 1 — Story". */
  label?: string;
  startTime?: string;
  endTime?: string;
  title: string;
  note?: string;
  /** Marks an item the general public may attend, e.g. a closing screening. */
  isPublic?: boolean;
};

export type EventHost = {
  name: string;
  role?: string;
  bio?: string;
  photoUrl?: string;
  /** Links to /humans/{slug} when the host is also a hub user. */
  profileSlug?: string;
  links?: {
    linkedin?: string;
    site?: string;
    x?: string;
  };
};

export type PricingTier = {
  label: string;
  priceCents: number;
  note?: string;
  url?: string;
  /** YYYY-MM-DD — informational; not enforced server-side. */
  availableUntil?: string;
  soldOut?: boolean;
};

export type FaqEntry = {
  q: string;
  a: string;
};

// ─── primitives ────────────────────────────────────────────────────

/** Accepts an already-parsed array or a JSON string; anything else becomes []. */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trimmed non-empty string, or undefined. */
function str(value: unknown, maxLength = 2000): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

/** Only http(s) and site-relative URLs — keeps javascript: and data: out of hrefs and img src. */
function url(value: unknown): string | undefined {
  const candidate = str(value, 2000);
  if (!candidate) return undefined;
  if (candidate.startsWith("/")) return candidate;
  return /^https?:\/\//i.test(candidate) ? candidate : undefined;
}

/** YYYY-MM-DD, or undefined. */
function isoDate(value: unknown): string | undefined {
  const candidate = str(value, 10);
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
}

function bool(value: unknown): boolean | undefined {
  return value === true ? true : undefined;
}

/** Drops undefined keys so the serialized JSON stays minimal and diffable. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}

/** Shared shape: parse to an array, map each entry, drop the ones that fail. */
function parseList<T>(value: unknown, mapEntry: (entry: Record<string, unknown>) => T | null): T[] {
  return toArray(value)
    .filter(isRecord)
    .map(mapEntry)
    .filter((entry): entry is T => entry !== null);
}

/** Canonical JSON string, or null when there is nothing to store. */
function serializeList<T>(entries: T[]): string | null {
  return entries.length ? JSON.stringify(entries) : null;
}

// ─── gallery ───────────────────────────────────────────────────────

export function parseGallery(value: unknown): GalleryImage[] {
  return parseList(value, (entry) => {
    const src = url(entry.url);
    if (!src) return null;
    return compact({ url: src, alt: str(entry.alt, 300), caption: str(entry.caption, 500) });
  });
}

export function serializeGallery(value: unknown): string | null {
  return serializeList(parseGallery(value));
}

// ─── agenda ────────────────────────────────────────────────────────

export function parseAgenda(value: unknown): AgendaItem[] {
  return parseList(value, (entry) => {
    const title = str(entry.title, 300);
    if (!title) return null;
    return compact({
      date: isoDate(entry.date),
      label: str(entry.label, 120),
      startTime: str(entry.startTime, 20),
      endTime: str(entry.endTime, 20),
      title,
      note: str(entry.note, 1000),
      isPublic: bool(entry.isPublic),
    });
  });
}

export function serializeAgenda(value: unknown): string | null {
  return serializeList(parseAgenda(value));
}

/**
 * Groups agenda items into days, preserving the order they were authored in.
 * Items with no `date` land in a single leading undated group, so a single-day
 * event can list a schedule without repeating the date on every row.
 */
export function groupAgendaByDay(
  items: AgendaItem[]
): Array<{ date?: string; label?: string; items: AgendaItem[] }> {
  const groups: Array<{ date?: string; label?: string; items: AgendaItem[] }> = [];

  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) {
      last.items.push(item);
      if (!last.label && item.label) last.label = item.label;
      continue;
    }
    groups.push({ date: item.date, label: item.label, items: [item] });
  }

  return groups;
}

// ─── hosts ─────────────────────────────────────────────────────────

export function parseHosts(value: unknown): EventHost[] {
  return parseList(value, (entry) => {
    const name = str(entry.name, 200);
    if (!name) return null;

    const rawLinks = isRecord(entry.links) ? entry.links : {};
    const links = compact({
      linkedin: url(rawLinks.linkedin),
      site: url(rawLinks.site),
      x: url(rawLinks.x),
    });

    return compact({
      name,
      role: str(entry.role, 200),
      bio: str(entry.bio, 2000),
      photoUrl: url(entry.photoUrl),
      profileSlug: str(entry.profileSlug, 200),
      links: Object.keys(links).length ? links : undefined,
    });
  });
}

export function serializeHosts(value: unknown): string | null {
  return serializeList(parseHosts(value));
}

// ─── pricing tiers ─────────────────────────────────────────────────

export function parsePricingTiers(value: unknown): PricingTier[] {
  return parseList(value, (entry) => {
    const label = str(entry.label, 200);
    const priceCents =
      typeof entry.priceCents === "number" && Number.isFinite(entry.priceCents)
        ? Math.max(0, Math.round(entry.priceCents))
        : null;
    if (!label || priceCents === null) return null;

    return compact({
      label,
      priceCents,
      note: str(entry.note, 500),
      url: url(entry.url),
      availableUntil: isoDate(entry.availableUntil),
      soldOut: bool(entry.soldOut),
    });
  });
}

export function serializePricingTiers(value: unknown): string | null {
  return serializeList(parsePricingTiers(value));
}

// ─── faq ───────────────────────────────────────────────────────────

export function parseFaq(value: unknown): FaqEntry[] {
  return parseList(value, (entry) => {
    const q = str(entry.q, 500);
    const a = str(entry.a, 5000);
    if (!q || !a) return null;
    return { q, a };
  });
}

export function serializeFaq(value: unknown): string | null {
  return serializeList(parseFaq(value));
}

// ─── video ─────────────────────────────────────────────────────────

/**
 * Extracts the YouTube video id from the URL shapes people actually paste
 * (watch?v=, youtu.be/, /shorts/, /embed/, /live/). Returns null for anything
 * else — the caller must never interpolate a raw user URL into an iframe src.
 */
export function youTubeIdFromUrl(value: string | null | undefined): string | null {
  const candidate = str(value, 500);
  if (!candidate) return null;

  // A bare id, pasted straight from the address bar fragment.
  if (/^[\w-]{11}$/.test(candidate)) return candidate;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  const fromQuery = parsed.searchParams.get("v");
  if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) return fromQuery;

  const segments = parsed.pathname.split("/").filter(Boolean);
  // youtu.be/<id>, /shorts/<id>, /embed/<id>, /live/<id>
  const candidateSegment =
    host === "youtu.be"
      ? segments[0]
      : ["shorts", "embed", "live"].includes(segments[0] ?? "")
        ? segments[1]
        : undefined;

  return candidateSegment && /^[\w-]{11}$/.test(candidateSegment) ? candidateSegment : null;
}

/** Privacy-preserving embed URL, or null when the URL isn't a recognizable YouTube link. */
export function youTubeEmbedUrl(value: string | null | undefined): string | null {
  const id = youTubeIdFromUrl(value);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/**
 * Write-side guard for `videoUrl`. Only a URL the player can actually embed is
 * storable, so what's in the column always matches what renders — and a
 * `javascript:` or `data:` URL can never be persisted in the first place.
 * Returns null for empty input (clearing the field); throws for junk so the
 * API can reject the request rather than silently dropping the value.
 */
export function normalizeVideoUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const candidate = str(value, 500);
  if (!candidate) return null;

  if (!youTubeIdFromUrl(candidate)) {
    throw new Error("expected a YouTube URL (watch, youtu.be, shorts, or embed)");
  }
  return candidate;
}
