// src/lib/drip/segment.ts
// Audience rules for drip campaigns.
//
// sqlite stores Contact.tags as a JSON string, so tag predicates cannot be
// pushed into SQL. The split below is deliberate:
//   candidateWhere()  → cheap SQL prefilter (status / source / timestamps)
//   matchesSegment()  → exact predicate in TS (tags + everything else)
// Both must agree; candidateWhere may only ever be *wider* than matchesSegment.

import type { Prisma } from "@/generated/client";

export type DripSegment = {
  /** Contact.source values. `"onboarding:*"` matches any onboarding slug. */
  sources?: string[];
  /** Contact.status values (NEW | CONTACTED | QUALIFIED | WON | LOST). */
  statuses?: string[];
  /** Matches if the lead has at least one of these tags. */
  anyTags?: string[];
  /** Matches only if the lead has every one of these tags. */
  allTags?: string[];
  /** Excludes the lead if it has any of these tags. */
  noneTags?: string[];
  /** Lead must be at least this old — lets a welcome email land before a drip. */
  minAgeHours?: number;
  /** Lead must be no older than this — keeps a launch campaign off the archive. */
  maxAgeDays?: number;
  /** Lead's lastActivityAt (or createdAt) must be at least this stale. */
  inactiveForDays?: number;
  /**
   * Lead can receive an automated call: phone present, call consent given,
   * not do-not-call. Set this on any campaign containing CALL steps so it
   * doesn't enroll leads it can never dial. (E.164 validity is re-checked at
   * dial time — here we only gate on what SQL can see.)
   */
  callable?: boolean;
  /** Lead can receive SMS: phone and consent present, without an SMS opt-out. */
  smsable?: boolean;
  /** Cohort ids or slugs, or any cohort enrollment. */
  cohorts?: string[] | "any";
  /** Paid product audiences resolved for broadcasts. */
  products?: Array<"self-paced" | "membership">;
  /** Include User records in addition to leads. */
  includeUsers?: boolean;
};

export type ContactForMatch = {
  status: string | null;
  source: string | null;
  tags: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  unsubscribedAt: Date | null;
  phone: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  doNotCall: boolean;
  smsOptOutAt: Date | null;
};

const SEGMENT_KEYS: ReadonlyArray<keyof DripSegment> = [
  "sources",
  "statuses",
  "anyTags",
  "allTags",
  "noneTags",
  "minAgeHours",
  "maxAgeDays",
  "inactiveForDays",
  "callable",
  "smsable",
  "cohorts",
  "products",
  "includeUsers",
];

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : undefined;
};

const positiveInt = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

const cohortsValue = (value: unknown): string[] | "any" | undefined =>
  value === "any" ? "any" : stringList(value);

const productsValue = (
  value: unknown
): Array<"self-paced" | "membership"> | undefined => {
  if (!Array.isArray(value)) return undefined;
  const products = value.filter(
    (item): item is "self-paced" | "membership" =>
      item === "self-paced" || item === "membership"
  );
  return products.length ? [...new Set(products)] : undefined;
};

/**
 * Parse a stored segment JSON string into a normalized DripSegment.
 * Unknown keys, wrong types, and empty lists are dropped — a malformed segment
 * degrades to `{}` (match everyone) rather than throwing mid-sweep, so callers
 * should treat `{}` as "no constraints" and gate on `autoEnroll` separately.
 */
export function parseSegment(raw: string | null | undefined): DripSegment {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const input = parsed as Record<string, unknown>;
  const out: DripSegment = {};
  for (const key of SEGMENT_KEYS) {
    const value =
      key === "minAgeHours" || key === "maxAgeDays" || key === "inactiveForDays"
        ? positiveInt(input[key])
        : key === "callable" || key === "smsable" || key === "includeUsers"
          ? input[key] === true || undefined
          : key === "cohorts"
            ? cohortsValue(input[key])
            : key === "products"
              ? productsValue(input[key])
          : stringList(input[key]);
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function serializeSegment(segment: DripSegment): string {
  return JSON.stringify(parseSegment(JSON.stringify(segment)));
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function sourceMatches(source: string | null, patterns: string[]): boolean {
  if (!source) return false;
  return patterns.some((pattern) =>
    pattern.endsWith("*")
      ? source.startsWith(pattern.slice(0, -1))
      : source === pattern
  );
}

/**
 * Exact segment predicate. Unsubscribed contacts never match any segment —
 * suppression is enforced here as well as at send time (belt and braces).
 */
export function matchesSegment(
  contact: ContactForMatch,
  segment: DripSegment,
  now: Date = new Date()
): boolean {
  // Broadcast-only fields are deliberately ignored here; the broadcast audience resolver handles them.
  if (contact.unsubscribedAt) return false;

  if (segment.statuses && !segment.statuses.includes(contact.status ?? "NEW")) {
    return false;
  }
  if (segment.sources && !sourceMatches(contact.source, segment.sources)) {
    return false;
  }

  const tags = parseTags(contact.tags);
  if (segment.anyTags && !segment.anyTags.some((tag) => tags.includes(tag))) {
    return false;
  }
  if (segment.allTags && !segment.allTags.every((tag) => tags.includes(tag))) {
    return false;
  }
  if (segment.noneTags && segment.noneTags.some((tag) => tags.includes(tag))) {
    return false;
  }

  const ageMs = now.getTime() - contact.createdAt.getTime();
  if (segment.minAgeHours && ageMs < segment.minAgeHours * 3_600_000) return false;
  if (segment.maxAgeDays && ageMs > segment.maxAgeDays * 86_400_000) return false;

  if (segment.inactiveForDays) {
    const lastTouch = contact.lastActivityAt ?? contact.createdAt;
    if (now.getTime() - lastTouch.getTime() < segment.inactiveForDays * 86_400_000) {
      return false;
    }
  }

  if (segment.callable) {
    if (!contact.phone || !contact.phoneConsentAt || contact.doNotCall) return false;
  }
  if (segment.smsable) {
    if (
      !contact.phone ||
      (!contact.smsMarketingConsentAt && !contact.smsTransactionalConsentAt) ||
      contact.smsOptOutAt
    ) return false;
  }
  return true;
}

/**
 * SQL prefilter for the enrollment sweep. Intentionally omits tag predicates
 * (sqlite JSON strings) — matchesSegment() is still the authority.
 */
export function candidateWhere(
  segment: DripSegment,
  now: Date = new Date()
): Prisma.ContactWhereInput {
  // Broadcast-only fields are deliberately ignored here; the broadcast audience resolver handles them.
  const where: Prisma.ContactWhereInput = { unsubscribedAt: null };

  if (segment.statuses) where.status = { in: segment.statuses };

  const exactSources = segment.sources?.filter((s) => !s.endsWith("*"));
  const prefixes = segment.sources
    ?.filter((s) => s.endsWith("*"))
    .map((s) => s.slice(0, -1));
  if (segment.sources?.length) {
    where.OR = [
      ...(exactSources?.length ? [{ source: { in: exactSources } }] : []),
      ...(prefixes?.map((prefix) => ({ source: { startsWith: prefix } })) ?? []),
    ];
  }

  const createdAt: Prisma.DateTimeFilter = {};
  if (segment.minAgeHours) {
    createdAt.lte = new Date(now.getTime() - segment.minAgeHours * 3_600_000);
  }
  if (segment.maxAgeDays) {
    createdAt.gte = new Date(now.getTime() - segment.maxAgeDays * 86_400_000);
  }
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  if (segment.callable) {
    where.phone = { not: null };
    where.phoneConsentAt = { not: null };
    where.doNotCall = false;
  }
  if (segment.smsable) {
    where.phone = { not: null };
    where.smsOptOutAt = null;
    const smsConsent = {
      OR: [
        { smsMarketingConsentAt: { not: null } },
        { smsTransactionalConsentAt: { not: null } },
      ],
    };
    where.AND = Array.isArray(where.AND)
      ? [...where.AND, smsConsent]
      : where.AND
        ? [where.AND, smsConsent]
        : [smsConsent];
  }

  return where;
}

/** Human-readable one-liner for the admin UI. */
export function describeSegment(segment: DripSegment): string {
  const parts: string[] = [];
  if (segment.sources) parts.push(`source ∈ ${segment.sources.join(", ")}`);
  if (segment.statuses) parts.push(`status ∈ ${segment.statuses.join(", ")}`);
  if (segment.anyTags) parts.push(`any tag: ${segment.anyTags.join(", ")}`);
  if (segment.allTags) parts.push(`all tags: ${segment.allTags.join(", ")}`);
  if (segment.noneTags) parts.push(`not tagged: ${segment.noneTags.join(", ")}`);
  if (segment.minAgeHours) parts.push(`≥ ${segment.minAgeHours}h old`);
  if (segment.maxAgeDays) parts.push(`≤ ${segment.maxAgeDays}d old`);
  if (segment.inactiveForDays) parts.push(`inactive ${segment.inactiveForDays}d+`);
  if (segment.callable) parts.push("callable (phone + call consent)");
  if (segment.smsable) parts.push("SMS-able (phone + SMS consent + not opted out)");
  if (segment.cohorts) {
    parts.push(
      `cohorts: ${segment.cohorts === "any" ? "any" : segment.cohorts.join(", ")}`
    );
  }
  if (segment.products) parts.push(`products: ${segment.products.join(", ")}`);
  if (segment.includeUsers) parts.push("include all users");
  return parts.length ? parts.join(" · ") : "Everyone (no filters)";
}
