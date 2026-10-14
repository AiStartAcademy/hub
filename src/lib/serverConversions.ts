// Server-side conversion dispatch — GA4 Measurement Protocol + Meta Conversions API.
//
// WHY THIS EXISTS
// The hub's conversion events (`generate_lead`, `purchase`) are pushed to the GTM
// dataLayer by src/lib/analytics.ts. GTM only forwards a dataLayer event to GA4/Meta
// if a tag + trigger exist for that exact event name — and today only `ui_click` has
// one. So the conversions reach the dataLayer and stop there: paid clicks land, but
// the ad platforms never receive the Lead or Purchase events that follow.
//
// Rather than depend on a GTM container being configured correctly, this module
// sends conversions from the server, where the onboarding
// submission and the Stripe webhook already run. Server-side dispatch is also
// strictly better than the browser tag it replaces: it survives ad blockers, iOS ITP
// cookie truncation, and any future GTM misconfiguration, and the Stripe webhook is
// already the source of truth for payment.
//
// DEDUPLICATION
// Every event carries a stable `eventId` (the onboarding response id, or the Stripe
// session id). GA4 dedupes on `transaction_id`, Meta on `event_id`. So if the browser
// tags are ever wired up in GTM later, the same conversion arriving twice collapses
// into one — this module and a future browser tag can safely coexist.
//
// FAILURE POLICY
// Analytics must never break a checkout or a quiz submission. Every export swallows
// its errors and logs them. Callers should not await these in a way that blocks a
// user response — see the `void dispatch...()` call sites.
//
// CONFIG (all optional — a missing var disables just that destination)
//   GA4_MEASUREMENT_ID   G-XXXXXXXXXX
//   GA4_API_SECRET       GA4 Admin → Data Streams → Measurement Protocol API secrets
//   META_PIXEL_ID        Meta Events Manager → Data sources
//   META_CAPI_TOKEN      Meta Events Manager → Settings → Conversions API token
//   META_TEST_EVENT_CODE optional; routes events to Test Events for verification
import { brand } from "@/config/brand";
import { createHash } from "node:crypto";
import { getSecret } from "@/lib/secrets";
import { logger } from "@/lib/logger";

const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";
const META_API_VERSION = "v21.0";

/** Identity + context lifted off the inbound request. No PII is logged. */
export type ConversionContext = {
  /** GA4 client id, parsed from the `_ga` cookie. */
  gaClientId?: string;
  /** Meta browser id, from the `_fbp` cookie. */
  fbp?: string;
  /** Meta click id, from the `_fbc` cookie or derived from a `fbclid` param. */
  fbc?: string;
  clientIp?: string;
  userAgent?: string;
  /** Full URL of the page that produced the conversion. */
  sourceUrl?: string;
  email?: string;
  phone?: string;
};

export type ConversionEvent = {
  /** GA4 event name. Meta's equivalent is resolved via META_EVENT_NAMES. */
  name: "generate_lead" | "purchase" | "lead_qualified" | "lead_won" | "lead_lost";
  /** Stable id for cross-destination dedupe (response id / Stripe session id / status-transition id). */
  eventId: string;
  value?: number;
  currency?: string;
  /** Extra GA4 event params. Must not contain PII. */
  params?: Record<string, string | number | undefined>;
  /**
   * "website" (default) is a real-time, user-triggered browser/API event. "system_generated"
   * marks a CRM/offline event — a human's later judgment call (a sales-team status change),
   * not something the visitor did on the site. GA4 has no equivalent concept, so this only
   * affects the Meta payload; sendToGa4 ignores it. See lead_qualified/won/lost call sites in
   * admin/contacts/actions.ts.
   */
  actionSource?: "website" | "system_generated";
  /** Contact.id — required (and only meaningful) for actionSource "system_generated". */
  leadId?: string;
};

// generate_lead/purchase are Meta's own standard events; the lead_* trio are intentionally
// NOT standard-event names (Meta reserves ~19 fixed names like Lead/Purchase/Schedule) — they
// surface in Events Manager as Custom Events, which is what lets an ad set later be pointed at
// "LeadWon" specifically instead of raw "Lead" volume.
const META_EVENT_NAMES: Record<ConversionEvent["name"], string> = {
  generate_lead: "Lead",
  purchase: "Purchase",
  lead_qualified: "LeadQualified",
  lead_won: "LeadWon",
  lead_lost: "LeadLost",
};

/**
 * Parse the GA4 client id out of a `_ga` cookie.
 * Cookie format is `GA1.1.<clientId1>.<clientId2>`; GA4 wants the last two parts
 * joined, e.g. `GA1.1.1234567890.1700000000` → `1234567890.1700000000`.
 */
export function parseGaClientId(gaCookie: string | undefined): string | undefined {
  if (!gaCookie) return undefined;
  const parts = gaCookie.split(".");
  if (parts.length < 4) return undefined;
  const clientId = `${parts[2]}.${parts[3]}`;
  return /^\d+\.\d+$/.test(clientId) ? clientId : undefined;
}

/**
 * Build a Meta `_fbc` value from a raw `fbclid` query param, for the case where the
 * Meta pixel never ran (ad blocker) and so never wrote the `_fbc` cookie itself.
 * Meta's documented format is `fb.<subdomainIndex>.<creationTime>.<fbclid>`.
 */
export function deriveFbc(fbclid: string | undefined, now: number = Date.now()): string | undefined {
  if (!fbclid) return undefined;
  const clean = fbclid.trim().slice(0, 512);
  return clean ? `fb.1.${now}.${clean}` : undefined;
}

/** Meta requires user identifiers to be SHA-256 of the normalized, lowercased value. */
function hashPii(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex");
}

/** Phones must be digits-only (with country code) before hashing. */
function hashPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (!digits) return undefined;
  return createHash("sha256").update(digits).digest("hex");
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ) as Partial<T>;
}

/**
 * Send one event to GA4 via the Measurement Protocol.
 *
 * GA4 requires a `client_id`. When the `_ga` cookie is absent (a genuinely
 * cookieless visitor) we fall back to a deterministic pseudo-id derived from the
 * event id, so the conversion is still counted rather than dropped. Such a hit
 * won't stitch to the visitor's earlier session — an unattributed conversion is
 * strictly better than a missing one.
 */
async function sendToGa4(event: ConversionEvent, ctx: ConversionContext): Promise<void> {
  // Admin-manageable via Settings → Integrations (DB Secret → env fallback).
  const [measurementId, apiSecret] = await Promise.all([
    getSecret("GA4_MEASUREMENT_ID"),
    getSecret("GA4_API_SECRET"),
  ]);
  if (!measurementId || !apiSecret) return;

  const clientId =
    ctx.gaClientId ??
    `${parseInt(createHash("md5").update(event.eventId).digest("hex").slice(0, 8), 16)}.${Math.floor(Date.now() / 1000)}`;

  const body = {
    client_id: clientId,
    // Non-personalized: this is a server hit, we are not building an ads audience here.
    non_personalized_ads: false,
    events: [
      {
        name: event.name,
        params: dropUndefined({
          ...event.params,
          transaction_id: event.eventId,
          value: event.value,
          currency: event.value !== undefined ? (event.currency ?? "USD") : undefined,
          // Marks the hit as server-sent so it can be segmented in GA4 if the
          // browser tags are ever enabled alongside it.
          delivery_channel: "server",
          engagement_time_msec: 1,
        }),
      },
    ],
  };

  const url = `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // The MP collect endpoint returns 204 with no body on success and, notably,
  // also 2xx for malformed payloads — so a non-2xx here is a transport problem.
  if (!res.ok) {
    throw new Error(`GA4 Measurement Protocol responded ${res.status}`);
  }
}

/** Send one event to the Meta Conversions API. */
async function sendToMeta(event: ConversionEvent, ctx: ConversionContext): Promise<void> {
  // Admin-manageable via Settings → Integrations (DB Secret → env fallback).
  const [pixelId, token, testEventCode] = await Promise.all([
    getSecret("META_PIXEL_ID"),
    getSecret("META_CAPI_TOKEN"),
    getSecret("META_TEST_EVENT_CODE"),
  ]);
  if (!pixelId || !token) return;

  const actionSource = event.actionSource ?? "website";
  const isCrm = actionSource === "system_generated";

  const userData = dropUndefined({
    em: hashPii(ctx.email),
    ph: hashPhone(ctx.phone),
    fbp: ctx.fbp,
    fbc: ctx.fbc,
    client_ip_address: ctx.clientIp,
    client_user_agent: ctx.userAgent,
    // A CRM event has no visitor request to attach an id to — it's a sales-team judgment
    // call, made outside any page view — so it's threaded through the event, not ctx.
    lead_id: isCrm ? event.leadId : undefined,
  });

  // Meta rejects an event with no way at all to identify the user.
  if (Object.keys(userData).length === 0) {
    logger.warn(
      { event: event.name, eventId: event.eventId },
      "[conversions] skipping Meta CAPI event — no user identifiers available"
    );
    return;
  }

  const payload = {
    data: [
      dropUndefined({
        event_name: META_EVENT_NAMES[event.name],
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: actionSource,
        event_source_url: isCrm ? undefined : ctx.sourceUrl,
        user_data: userData,
        // Meta's documented shape for CRM/offline lead-quality events — distinguishes a
        // human's later status judgment from a real-time website/API event.
        custom_data: isCrm
          ? { event_source: "crm", lead_event_source: brand.ids.leadEventSource }
          : event.value !== undefined
            ? { value: event.value, currency: event.currency ?? "USD" }
            : undefined,
      }),
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    // Meta returns a structured error body worth surfacing — it names the exact
    // field it rejected, which is otherwise very hard to guess.
    const detail = await res.text().catch(() => "");
    throw new Error(`Meta CAPI responded ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * Fire one conversion to every configured destination.
 *
 * Never throws and never rejects: each destination is isolated so a Meta outage
 * cannot suppress the GA4 hit, and neither can affect the caller. Call it with
 * `void dispatchConversion(...)` from a request handler so the user's response
 * is not delayed by two outbound HTTP calls.
 */
export async function dispatchConversion(
  event: ConversionEvent,
  ctx: ConversionContext
): Promise<void> {
  const results = await Promise.allSettled([sendToGa4(event, ctx), sendToMeta(event, ctx)]);
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      logger.error(
        {
          destination: i === 0 ? "ga4" : "meta",
          event: event.name,
          eventId: event.eventId,
          err: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
        "[conversions] dispatch failed"
      );
    }
  });
}

/**
 * Stripe metadata keys used to ferry ad identifiers from checkout creation (which
 * has the browser's cookies) to the webhook (which does not). Kept short because
 * Stripe caps metadata at 50 keys / 500 chars per value.
 */
export const CONVERSION_METADATA_KEYS = ["gaCid", "fbp", "fbc"] as const;

/** Extract just the ad identifiers from a request, shaped for Stripe metadata. */
export function conversionIdsFromRequest(req: {
  cookies: { get(name: string): { value: string } | undefined };
  url: string;
}): Record<string, string> {
  const url = (() => {
    try {
      return new URL(req.url);
    } catch {
      return undefined;
    }
  })();

  return dropUndefined({
    gaCid: parseGaClientId(req.cookies.get("_ga")?.value),
    fbp: req.cookies.get("_fbp")?.value,
    fbc:
      req.cookies.get("_fbc")?.value ??
      deriveFbc(url?.searchParams.get("fbclid") ?? undefined),
  }) as Record<string, string>;
}

/**
 * Rebuild a ConversionContext inside the Stripe webhook, from the metadata stashed
 * at checkout creation plus the buyer's email off the Checkout Session.
 *
 * There is no request IP or user agent here — the caller is Stripe, not the buyer —
 * so those are deliberately omitted rather than filled with the server's own values,
 * which would poison Meta's match quality.
 */
export function contextFromStripeMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
  identity: { email?: string; phone?: string } = {}
): ConversionContext {
  return dropUndefined({
    gaClientId: metadata?.gaCid,
    fbp: metadata?.fbp,
    fbc: metadata?.fbc,
    email: identity.email,
    phone: identity.phone,
  });
}

/**
 * Build a ConversionContext from an inbound request's cookies and headers.
 *
 * `email`/`phone` are passed separately by the caller rather than read here — they
 * come from validated form answers, not from the request envelope.
 */
export function contextFromRequest(
  req: {
    cookies: { get(name: string): { value: string } | undefined };
    headers: { get(name: string): string | null };
    url: string;
  },
  identity: { email?: string; phone?: string } = {}
): ConversionContext {
  const url = (() => {
    try {
      return new URL(req.url);
    } catch {
      return undefined;
    }
  })();

  // x-forwarded-for is a comma-separated chain; the client is the first entry.
  const forwarded = req.headers.get("x-forwarded-for");
  const clientIp = forwarded?.split(",")[0]?.trim() || undefined;

  return dropUndefined({
    gaClientId: parseGaClientId(req.cookies.get("_ga")?.value),
    fbp: req.cookies.get("_fbp")?.value,
    fbc:
      req.cookies.get("_fbc")?.value ??
      deriveFbc(url?.searchParams.get("fbclid") ?? undefined),
    clientIp,
    userAgent: req.headers.get("user-agent") ?? undefined,
    sourceUrl: url ? `${url.origin}${url.pathname}` : undefined,
    email: identity.email,
    phone: identity.phone,
  });
}
