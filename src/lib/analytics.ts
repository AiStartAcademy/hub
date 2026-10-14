// Client-side analytics helper — pushes events to the GTM dataLayer.
// GTM (NEXT_PUBLIC_GTM_ID) forwards these to GA4 (G-XXXXXXXXXX) and Meta per the tags
// configured in the GTM UI. Standard GA4 event names are used so they can be
// marked as Key events in the GA4 property (the hub is the funnel property).
// See ../../docs/features/ANALYTICS_SEO.md.

import { hasAnalyticsConsent } from "./cookieConsent";

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

// Events GTM forwards to Meta as well as GA4. Meta's pixel ignores Google
// Consent Mode, so these must be withheld from the dataLayer entirely unless the
// visitor accepted. Non-conversion events (ui_click, page_view) still push and
// are governed by Consent Mode — denied visitors produce cookieless pings only.
const CONSENT_GATED_EVENTS = new Set([
  "generate_lead",
  "begin_checkout",
  "purchase",
  "sign_up",
]);

/** Push a named event (+ optional params) to the GTM dataLayer. No-op on the server. */
export function trackEvent(
  event: string,
  params: Record<string, unknown> = {}
): void {
  if (typeof window === "undefined") return;
  if (CONSENT_GATED_EVENTS.has(event) && !hasAnalyticsConsent()) return;
  window.dataLayer = window.dataLayer ?? [];
  // Drop undefined values so GA4 doesn't receive empty params.
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  );
  window.dataLayer.push({ event, ...clean });
}
