// src/lib/drip/link-utm.ts
// UTM tagging for drip email links — pure string logic, no server-only
// imports (no prisma, no mail/nodemailer), so both the send-time renderer
// (template.ts) and the admin editor's client-side preview can share one
// implementation instead of drifting apart.
//
// Convention matches the rest of the repo (see docs/features/ATTRIBUTION.md
// and website/PAGE_PLAYBOOK.md's `utm_source=website&utm_medium=<section>`
// and the Luma reminder's `utm_source=email&utm_medium=lumasubs`): source
// names the channel, medium names the specific mechanism within it.

export const DRIP_UTM_SOURCE = "email";
export const DRIP_UTM_MEDIUM = "drip";

/**
 * Append (or leave alone) `utm_*` params on a URL.
 *
 * Idempotent: if the URL already carries `utm_source`, it's returned
 * unchanged. This lets callers tag a link once at the point they know its
 * role (e.g. the CTA button knows it's "cta") and then run a second, generic
 * pass over the rest of the rendered HTML without worrying about double
 * -tagging that same link.
 *
 * Handles both absolute (`https://host/path`) and site-relative (`/path`)
 * URLs, and inserts the query string before any `#fragment` — `?a=b#frag`,
 * never `#frag?a=b`.
 */
export function appendUtmParams(
  url: string,
  params: { campaign: string; content: string }
): string {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);

  const queryIndex = beforeHash.indexOf("?");
  const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const existingQuery = queryIndex === -1 ? "" : beforeHash.slice(queryIndex + 1);

  if (/(^|&)utm_source=/.test(existingQuery)) return url; // already tagged — no-op

  const utm = [
    ["utm_source", DRIP_UTM_SOURCE],
    ["utm_medium", DRIP_UTM_MEDIUM],
    ["utm_campaign", params.campaign],
    ["utm_content", params.content],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

  const query = existingQuery ? `${existingQuery}&${utm}` : utm;
  return `${base}?${query}${hash}`;
}

/**
 * Derive a stable, human-readable `utm_content` fragment from a link's
 * destination — so every current and future link gets tagged with something
 * meaningful without anyone hand-authoring a content label per link.
 */
export function deriveLinkContent(url: string): string {
  let pathname = url;
  let hash = "";

  const hashIndex = url.indexOf("#");
  if (hashIndex !== -1) {
    hash = url.slice(hashIndex);
    pathname = url.slice(0, hashIndex);
  }
  const queryIndex = pathname.indexOf("?");
  if (queryIndex !== -1) pathname = pathname.slice(0, queryIndex);

  // Strip protocol + host from an absolute URL, leaving just the path.
  const pathOnly = pathname.replace(/^https?:\/\/[^/]+/, "");

  if (pathOnly === "/courses") return "courses";
  if (pathOnly === "/assets") return "assets";
  if (pathOnly === "/cohorts" && hash === "#membership") return "membership";
  if (pathOnly === "/cohorts") return "cohorts";
  if (pathOnly.startsWith("/cohorts/")) {
    const id = pathOnly.slice("/cohorts/".length).split("/")[0];
    return id ? `cohort-${id}` : "cohorts";
  }

  const cleaned = pathOnly.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  return cleaned || "link";
}

/**
 * Tag every `href="…"` in a block of HTML with UTM params, skipping
 * `mailto:`/`tel:` links (no meaningful UTM semantics) and the exact
 * unsubscribe URL (a compliance link, not a marketing click). Already-tagged
 * hrefs (e.g. a CTA tagged individually before assembly) are left alone by
 * `appendUtmParams`'s own idempotency check.
 */
export function tagLinksInHtml(
  html: string,
  opts: { campaign: string; stepOrder: number; unsubscribeUrl: string }
): string {
  return html.replace(/href="([^"]+)"/g, (match, href: string) => {
    if (!/^(https?:)?\//.test(href)) return match; // mailto:, tel:, etc.
    if (href === opts.unsubscribeUrl) return match;
    const tagged = appendUtmParams(href, {
      campaign: opts.campaign,
      content: `step${opts.stepOrder}-${deriveLinkContent(href)}`,
    });
    return `href="${tagged}"`;
  });
}
