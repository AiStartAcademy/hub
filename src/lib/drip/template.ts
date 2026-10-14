// src/lib/drip/template.ts
// Renders a DripStep into a full, branded, inline-styled HTML email.
//
// Two hard rules, both enforced here rather than trusted to authors:
//  1. Every merge value is HTML-escaped. Step bodies are staff-authored HTML and
//     are inserted verbatim; contact-derived values never are.
//  2. Every drip email carries a working unsubscribe link. Marketing mail without
//     one is a deliverability and compliance problem, so the footer is appended by
//     the renderer, not by the template author.

import { brand, brandCityAddress, brandFromMailbox } from "@/config/brand";
import { escapeHtml } from "@/lib/mail";
import type { EmailScope } from "./emailScope";
import { MERGE_FIELD_TOKENS, MERGE_FIELD_PATTERN, type MergeFieldToken } from "./mergeFieldTokens";
import { appendUtmParams, tagLinksInHtml } from "./link-utm";
import type { TrackingSigner } from "./tracking";

const BRAND_NIGHT = "#1B1F3B";
const BRAND_VIOLET = "#7209B7";
const BRAND_TEAL = "#56E9EB";
const WORDMARK_BREAK = brand.wordmark.lastIndexOf(" ");
const WORDMARK_PREFIX = brand.wordmark.slice(0, WORDMARK_BREAK + 1);
const WORDMARK_SUFFIX = brand.wordmark.slice(WORDMARK_BREAK + 1);

// Fallback only — resolveDripFrom() in ./engine.ts is the actual source of
// truth at send time, sourcing the managed DRIP_EMAIL_FROM key from the
// Integrations store (src/lib/secrets.ts) so it can be rotated from the admin
// UI without a redeploy. These constants exist so a DB/env miss still sends
// mail rather than throwing, and so tests have a fixed value to assert against.
export type DripSenderEnvironment = Partial<
  Record<"DRIP_FROM" | "DRIP_REPLY_TO" | "AISA_FROM" | "AISA_REPLY_TO", string>
>;

function configuredSenderValue(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function resolveDripSender(
  env: DripSenderEnvironment = process.env as DripSenderEnvironment,
): { from: string; replyTo: string } {
  return {
    from:
      configuredSenderValue(env.DRIP_FROM, env.AISA_FROM) ?? brandFromMailbox,
    replyTo:
      configuredSenderValue(env.DRIP_REPLY_TO, env.AISA_REPLY_TO) ??
      brand.email.contact,
  };
}

const DEFAULT_DRIP_SENDER = resolveDripSender();
export const DRIP_FROM = DEFAULT_DRIP_SENDER.from;
export const DRIP_REPLY_TO = DEFAULT_DRIP_SENDER.replyTo;
export const COURSE_EMAIL_FOOTER_LINK_TEXT = "Stop course update emails";

export function courseEmailFooterText(cohortName: string | null | undefined): string {
  const name = cohortName?.trim() || "your cohort";
  return `You're receiving this because you're enrolled in ${name} at ${brand.wordmark}.`;
}

export type DripMergeContext = {
  name: string;
  email: string;
  unsubscribeUrl: string;
  appUrl: string;
  bookingUrl?: string | null;
  upcomingCohortsHtml?: string;
  nextCohortLine?: string;
  /**
   * Cart-recovery commerce context, resolved from the contact's latest
   * abandoned Payment/Membership. Absent for non-abandoned contacts; the
   * merge fields render safe generic fallbacks so shared copy never breaks.
   */
  abandonedItemTitle?: string;
  abandonedAmount?: string; // pre-formatted, e.g. "$150.00"
  resumeCheckoutUrl?: string;
  /**
   * Cohort reminder context (COHORT_SCHEDULE campaigns), resolved from the
   * enrollment's anchoring cohort by src/lib/drip/cohortAnchor.ts. Absent for
   * lead campaigns; the merge fields render safe fallbacks so shared copy
   * never breaks on an online-only or date-less cohort.
   */
  cohortTitle?: string;
  cohortStartDate?: string; // pre-formatted in the cohort's zone, e.g. "Monday, August 17, 2026"
  cohortStartTime?: string; // pre-formatted, e.g. "10:00 AM PDT"
  zoomLink?: string;
  venueAddress?: string;
  cohortUrl?: string;
  certificateId?: string;
  certificateUrl?: string;
  certificatePdfUrl?: string;
  certificatePngUrl?: string;
  linkedinAddUrl?: string;
  /**
   * Campaign slug and step order — required, not optional, because every
   * link in every drip email must carry UTM params (see ./link-utm.ts). A
   * missing value here would mean a caller forgot to wire tracking for that
   * send, not a legitimate "no tracking wanted" case.
   */
  campaignSlug: string;
  /**
   * Open/click instrumentation for this specific send. Absent for test sends
   * and previews, and when no tracking secret is configured — in which case the
   * rendered output is byte-identical to the untracked version (asserted by
   * tests/unit/drip-template.test.ts).
   */
  tracking?: TrackingSigner;
  emailScope?: EmailScope;
};

export type RenderableStep = {
  subject: string;
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  /** Position in the sequence — feeds the `stepN-` prefix on every UTM'd link. */
  order: number;
};

export type EmailShellContent = {
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  /** UTM content prefix; one-off mail uses order 1 without pretending to be a DripStep. */
  order: number;
};

type MergeFieldOptions = {
  htmlFieldsAsText: boolean;
};

type MergeFieldKind = "html" | "text" | "url";

type MergeFieldDefinition = {
  kind: MergeFieldKind;
  render: (ctx: DripMergeContext, options: MergeFieldOptions) => string;
};

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  // "Lead" is the capture fallback in onboarding-leads.ts — never greet someone with it.
  if (!first || first.toLowerCase() === "lead") return "there";
  return first;
}

const MERGE_FIELDS = {
  first_name: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(firstName(ctx.name)),
  },
  name: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.name.trim() || "there"),
  },
  email: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.email),
  },
  unsubscribe_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.unsubscribeUrl,
  },
  app_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.appUrl,
  },
  cohorts_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => `${ctx.appUrl}/cohorts`,
  },
  booking_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.bookingUrl ?? "",
  },
  upcoming_cohorts: {
    kind: "html",
    render: (ctx: DripMergeContext, options: MergeFieldOptions) =>
      options.htmlFieldsAsText ? stripHtml(ctx.upcomingCohortsHtml ?? "") : (ctx.upcomingCohortsHtml ?? ""),
  },
  next_cohort: {
    kind: "html",
    render: (ctx: DripMergeContext, options: MergeFieldOptions) =>
      options.htmlFieldsAsText ? stripHtml(ctx.nextCohortLine ?? "") : (ctx.nextCohortLine ?? ""),
  },
  abandoned_item_title: {
    kind: "text",
    render: (ctx: DripMergeContext) =>
      escapeHtml(ctx.abandonedItemTitle ?? "your cohort"),
  },
  abandoned_amount: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.abandonedAmount ?? ""),
  },
  resume_checkout_url: {
    kind: "url",
    render: (ctx: DripMergeContext) =>
      ctx.resumeCheckoutUrl ?? `${ctx.appUrl}/cohorts`,
  },
  cohort_name: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.cohortTitle ?? "your cohort"),
  },
  cohort_start_date: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.cohortStartDate ?? "soon"),
  },
  cohort_start_time: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.cohortStartTime ?? ""),
  },
  zoom_link: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.zoomLink ?? `${ctx.appUrl}/dashboard`,
  },
  venue_address: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.venueAddress ?? ""),
  },
  cohort_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.cohortUrl ?? `${ctx.appUrl}/cohorts`,
  },
  certificate_id: {
    kind: "text",
    render: (ctx: DripMergeContext) => escapeHtml(ctx.certificateId ?? ""),
  },
  certificate_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.certificateUrl ?? `${ctx.appUrl}/settings`,
  },
  certificate_pdf_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.certificatePdfUrl ?? "",
  },
  certificate_png_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.certificatePngUrl ?? "",
  },
  linkedin_add_url: {
    kind: "url",
    render: (ctx: DripMergeContext) => ctx.linkedinAddUrl ?? "",
  },
} as const satisfies Record<string, MergeFieldDefinition>;

export type { MergeFieldToken } from "./mergeFieldTokens";
export { MERGE_FIELD_TOKENS, MERGE_FIELD_PATTERN } from "./mergeFieldTokens";

// Compile-time pin: every renderer key is a declared token and vice versa.
type _RendererKeysMatchTokens = [
  Exclude<keyof typeof MERGE_FIELDS, MergeFieldToken>,
  Exclude<MergeFieldToken, keyof typeof MERGE_FIELDS>,
] extends [never, never]
  ? true
  : never;
const _rendererKeysMatchTokens: _RendererKeysMatchTokens = true;
void _rendererKeysMatchTokens;

export const CTA_URL_MERGE_FIELD_TOKENS = Object.freeze(
  MERGE_FIELD_TOKENS.filter((token) => MERGE_FIELDS[token].kind === "url")
);


const CTA_URL_MERGE_FIELD_TOKEN_SET = new Set<string>(CTA_URL_MERGE_FIELD_TOKENS);

export function isSupportedCtaUrlMergeField(token: string): boolean {
  return CTA_URL_MERGE_FIELD_TOKEN_SET.has(token.toLowerCase());
}

function buildMergeValues(
  ctx: DripMergeContext,
  options: MergeFieldOptions
): Record<MergeFieldToken, string> {
  const values = {} as Record<MergeFieldToken, string>;
  for (const token of MERGE_FIELD_TOKENS) {
    values[token] = MERGE_FIELDS[token].render(ctx, options);
  }
  return values;
}

function replaceMergeFields(input: string, values: Record<MergeFieldToken, string>): string {
  return input.replace(MERGE_FIELD_PATTERN, (_match, token: string) => {
    const key = token.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key as MergeFieldToken] : "";
  });
}

function mergeValues(
  ctx: DripMergeContext,
  options: { htmlFieldsAsText: boolean }
): Record<string, string> {
  // Contact-derived fields stay escaped forever. The cohort snippets are the
  // one sanctioned HTML exception: they are generated by our own renderer from
  // live DB state, so stale hardcoded dates/prices never leak into mail copy.
  return buildMergeValues(ctx, options);
}

/**
 * Replace `{{token}}` merge fields. Values are escaped, so a lead whose name is
 * `<script>` cannot inject markup. Unknown tokens are stripped rather than left
 * as literal braces in a customer-facing email.
 */
export function renderMergeFields(input: string, ctx: DripMergeContext): string {
  const values = mergeValues(ctx, { htmlFieldsAsText: false });
  return replaceMergeFields(input, values);
}

export function renderEmailSubject(subject: string, ctx: DripMergeContext): string {
  // Subject lines are plain text: run merges, then strip any tags the escape
  // step introduced (e.g. an escaped name) back to readable characters.
  const values = mergeValues(ctx, { htmlFieldsAsText: true });
  const merged = replaceMergeFields(subject, values)
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return merged.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function renderSubject(step: RenderableStep, ctx: DripMergeContext): string {
  return renderEmailSubject(step.subject, ctx);
}

export function renderEmailShell(content: EmailShellContent, ctx: DripMergeContext): string {
  const body = renderMergeFields(content.body, ctx);

  // Tagged directly at construction, not by the generic pass below, so it
  // carries a "cta" content tag even when it points at the exact same URL as
  // another link in the same email (the footer's "Upcoming cohorts" link, or
  // a body link) — otherwise a click on the button and a click on plain text
  // would be indistinguishable in analytics.
  const cta =
    content.ctaLabel && content.ctaUrl
      ? `
        <div style="text-align:center;margin:32px 0 8px">
          <a href="${appendUtmParams(renderMergeFields(content.ctaUrl, ctx), { campaign: ctx.campaignSlug, content: `step${content.order}-cta` })}"
             style="display:inline-block;background:${BRAND_VIOLET};color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
            ${escapeHtml(content.ctaLabel)}
          </a>
        </div>`
      : "";

  const footerPreferences =
    ctx.emailScope === "course"
      ? `      <p style="margin:0 0 6px">${courseEmailFooterText(
          escapeHtml(ctx.cohortTitle?.trim() || "your cohort")
        )}</p>
      <p style="margin:0"><a href="${ctx.unsubscribeUrl}" style="color:#64748b;text-decoration:underline">${COURSE_EMAIL_FOOTER_LINK_TEXT}</a></p>`
      : `      <p style="margin:0">
        <a href="${ctx.appUrl}/cohorts" style="color:#64748b;text-decoration:underline">Upcoming cohorts</a>
        &nbsp;·&nbsp;
        <a href="${ctx.unsubscribeUrl}" style="color:#64748b;text-decoration:underline">Unsubscribe</a>
      </p>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif">
    <div style="padding:0 8px 16px">
      <span style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_NIGHT}">
        ${WORDMARK_PREFIX}<span style="font-weight:400;text-transform:none;letter-spacing:0">${WORDMARK_SUFFIX}</span>
      </span>
    </div>

    <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:3px solid ${BRAND_TEAL};border-radius:12px;padding:32px;color:#1a202c;font-size:16px;line-height:1.65">
      ${body}
      ${cta}
    </div>

    <div style="padding:20px 8px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.6">
      <p style="margin:0 0 6px">${brand.name} · ${brandCityAddress}</p>
${footerPreferences}
    </div>
  </div>
</body></html>`;

  // One pass over the fully assembled HTML tags everything the two steps
  // above didn't already handle: body links (Courses, Assets, the Q&A event,
  // the membership anchor), the footer's "Upcoming cohorts" link, and — for
  // any step whose body places {{upcoming_cohorts}} — the per-cohort rows
  // that ctx.upcomingCohortsHtml already carries. That block was pre-tagged
  // by the caller (it needs the DB row's own URL, which template.ts doesn't
  // have), so appendUtmParams's idempotency check just no-ops on it here
  // rather than double-appending. mailto: links and the exact unsubscribe URL
  // are excluded — see tagLinksInHtml.
  const tagged = tagLinksInHtml(html, {
    campaign: ctx.campaignSlug,
    stepOrder: content.order,
    unsubscribeUrl: ctx.unsubscribeUrl,
  });

  // Tracking is applied last, so the URL sealed inside each click token is the
  // final destination the reader would otherwise have reached (UTM params and
  // all). Without a signer this returns `tagged` untouched — byte-identical to
  // the untracked render.
  return applyTracking(tagged, ctx);
}

export function renderStepHtml(step: RenderableStep, ctx: DripMergeContext): string {
  return renderEmailShell(step, ctx);
}

/**
 * Wraps outbound links in the click redirect and appends the open pixel.
 *
 * The unsubscribe URL is deliberately excluded on both counts: a compliance
 * link must keep working even if tracking is misconfigured, and an opt-out must
 * never be counted as engagement. Relative and `mailto:`/`tel:` hrefs are left
 * alone — only absolute http(s) destinations can be signed.
 */
function applyTracking(html: string, ctx: DripMergeContext): string {
  const signer = ctx.tracking;
  if (!signer) return html;

  const withWrappedLinks = html.replace(/href="([^"]+)"/g, (match, href: string) => {
    if (href === ctx.unsubscribeUrl) return match;
    const wrapped = signer.clickUrl(href);
    return wrapped ? `href="${escapeHtml(wrapped)}"` : match;
  });

  const pixel =
    `<img src="${escapeHtml(signer.openUrl())}" alt="" width="1" height="1" ` +
    `style="display:block;width:1px;height:1px;border:0" />`;

  return withWrappedLinks.includes("</body>")
    ? withWrappedLinks.replace("</body>", `${pixel}</body>`)
    : withWrappedLinks + pixel;
}
