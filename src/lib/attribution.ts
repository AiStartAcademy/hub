// Marketing attribution: capture UTM params + ad click IDs from inbound links
// (ads, emails, social) and carry them through to leads and user profiles.
//
// This module is CLIENT-SAFE (no next/headers). The client captures into a
// first-touch cookie; server route handlers read that cookie off the request.

export const ATTRIBUTION_COOKIE = "aisa_attribution";
export const SEGMENT_COOKIE = "aisa_segment";
// Referral/coupon code captured from /join/CODE links (QR posters, affiliate
// shares, recovery emails). First-touch, 30 days — read at checkout to
// pre-apply the discount. Value is an UPPERCASE Coupon.code.
export const REF_COOKIE = "aisa_ref";
export const REF_COOKIE_MAX_AGE_DAYS = 30;

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

// Ad-platform click identifiers worth keeping for closed-loop reporting.
export const CLICK_ID_KEYS = [
  "fbclid", // Meta / Facebook / Instagram
  "gclid", // Google Ads
  "gbraid",
  "wbraid",
  "ttclid", // TikTok
  "li_fat_id", // LinkedIn
  "msclkid", // Microsoft / Bing
  "twclid", // X / Twitter
] as const;

export type Attribution = Partial<
  Record<(typeof UTM_KEYS)[number] | (typeof CLICK_ID_KEYS)[number], string>
> & {
  referrer?: string;
  landing_page?: string;
  captured_at?: string;
};

const ATTRIBUTION_KEYS = [
  ...UTM_KEYS,
  ...CLICK_ID_KEYS,
  "referrer",
  "landing_page",
  "captured_at",
] as const;

function normalizeAttributionValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
  return normalized || null;
}

function normalizeStoredAttribution(value: unknown): Attribution | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const attribution: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const maxLength = key === "landing_page" || key === "referrer" ? 2048 : 500;
    const normalized = normalizeAttributionValue(source[key], maxLength);
    if (normalized) attribution[key] = normalized;
  }
  return Object.keys(attribution).length > 0 ? attribution : null;
}

/** Pull known attribution params out of a URL query string. */
export function parseAttribution(params: URLSearchParams): Attribution {
  const attr: Attribution = {};
  for (const key of [...UTM_KEYS, ...CLICK_ID_KEYS]) {
    const value = params.get(key);
    const normalized = normalizeAttributionValue(value, 500);
    if (normalized) attr[key] = normalized;
  }
  return attr;
}

/** True if at least one real attribution signal (UTM or click id) is present. */
export function hasAttribution(attr: Attribution): boolean {
  return [...UTM_KEYS, ...CLICK_ID_KEYS].some((key) => !!attr[key]);
}

/** Safely parse the attribution cookie value (URI-encoded JSON). */
export function parseAttributionCookie(raw: string | undefined | null): Attribution | null {
  if (!raw) return null;
  try {
    return normalizeStoredAttribution(JSON.parse(decodeURIComponent(raw)));
  } catch {
    try {
      return normalizeStoredAttribution(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}

/** Normalize the optional onboarding segment carried into checkout. */
export function parseSegmentCookie(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 100);
  return normalized || null;
}
