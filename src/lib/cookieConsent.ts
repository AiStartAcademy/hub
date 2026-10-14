// Cookie-consent state + Google Consent Mode v2 signalling.
//
// Single source of truth for the visitor's choice in the CookieConsent banner.
// The stored value drives two things:
//   1. Google Consent Mode v2 signals (`analytics_storage` / `ad_storage` / …),
//      consumed by the GA4 tags inside GTM (NEXT_PUBLIC_GTM_ID).
//   2. Whether we push conversion events to the dataLayer at all — GTM forwards
//      those to Meta, which does NOT honour Google Consent Mode, so the gate has
//      to happen on our side. See ../lib/analytics.ts and
//      ../../docs/features/ANALYTICS_SEO.md.
//
// Defaults are denied and are set *before* the GTM snippet loads (see the
// `consent-mode-init` Script in src/app/layout.tsx), so a visitor who never
// answers the banner is treated as denied.

export const CONSENT_KEY = "aisa_cookie_consent";
export const CONSENT_CHANGE_EVENT = "cookie-consent-change";

export type ConsentStatus = "granted" | "denied" | "unset";

/** Read the stored choice. Returns "unset" on the server or before a decision. */
export function getConsent(): ConsentStatus {
  if (typeof window === "undefined") return "unset";
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (raw === "accepted") return "granted";
    if (raw === "declined") return "denied";
  } catch {
    // localStorage can throw in private mode / with storage disabled.
  }
  return "unset";
}

/** True only when the visitor explicitly accepted. "unset" is NOT consent. */
export function hasAnalyticsConsent(): boolean {
  return getConsent() === "granted";
}

/**
 * Persist the choice and push the matching Consent Mode v2 `update` so tags
 * already loaded in this pageview react without a reload.
 */
export function setConsent(status: "granted" | "denied"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CONSENT_KEY,
      status === "granted" ? "accepted" : "declined"
    );
  } catch {
    // Non-fatal: the Consent Mode update below still applies to this pageview.
  }
  pushConsentUpdate(status);
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: status }));
}

/** Push a Consent Mode v2 `update` command onto the dataLayer. */
export function pushConsentUpdate(status: "granted" | "denied"): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  // gtag's `arguments`-shaped command form — GTM reads consent commands off the
  // dataLayer in this positional format, not as a named `event` object.
  window.dataLayer.push({
    0: "consent",
    1: "update",
    2: {
      ad_storage: status,
      ad_user_data: status,
      ad_personalization: status,
      analytics_storage: status,
    },
    length: 3,
  } as unknown as Record<string, unknown>);
}

/**
 * The inline script that must run BEFORE the GTM snippet: denies every
 * non-essential storage type by default, then replays a previously stored
 * grant so returning visitors who accepted keep working.
 *
 * `security_storage` and `functionality_storage` stay granted — those cover
 * auth/session and preference cookies, which are strictly necessary.
 */
export const CONSENT_MODE_INIT_SCRIPT = `
window.dataLayer=window.dataLayer||[];
function gtag(){window.dataLayer.push(arguments);}
gtag('consent','default',{
  ad_storage:'denied',
  ad_user_data:'denied',
  ad_personalization:'denied',
  analytics_storage:'denied',
  functionality_storage:'granted',
  security_storage:'granted',
  wait_for_update:500
});
try{
  if(localStorage.getItem('${CONSENT_KEY}')==='accepted'){
    gtag('consent','update',{
      ad_storage:'granted',
      ad_user_data:'granted',
      ad_personalization:'granted',
      analytics_storage:'granted'
    });
  }
}catch(e){}
`.trim();
