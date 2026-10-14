// Client-side Meta Pixel helper. The pixel itself is injected by
// src/components/MetaPixel.tsx (id served by /api/meta-pixel from the
// Integrations registry); this module is the one safe way to fire events
// against it.
//
// Every conversion fired here MUST carry the same eventID as its server-side
// twin in src/lib/serverConversions.ts (Stripe session id for `Purchase`, the
// onboarding response id for `Lead`) — Meta dedupes on event_name + event_id
// within 48h, so browser and CAPI copies collapse into one conversion. The
// browser copy is still worth sending: it is what sets/carries `_fbp`/`_fbc`
// and lifts Event Match Quality above what a server-only hit can reach.

import { getConsent, type ConsentStatus } from "./cookieConsent";

type Fbq = (
  command: "track" | "trackCustom",
  eventName: string,
  params?: Record<string, unknown>,
  options?: { eventID: string }
) => void;

/** Meta is allowed to load or receive events only after an explicit grant. */
export function shouldLoadMetaPixel(consent: ConsentStatus): boolean {
  return consent === "granted";
}

/** Fire a standard Meta Pixel event. No-op when the pixel is not configured,
 *  not yet loaded, or blocked — the server-side CAPI twin (which is the
 *  source of truth for conversion counts) still reports it. */
export function fbqTrack(
  eventName: "Purchase" | "Lead",
  params: Record<string, unknown> = {},
  eventId?: string
): void {
  if (typeof window === "undefined") return;
  if (!shouldLoadMetaPixel(getConsent())) return;
  const fbq = (window as unknown as { fbq?: Fbq }).fbq;
  if (typeof fbq !== "function") return;
  try {
    fbq("track", eventName, params, eventId ? { eventID: eventId } : undefined);
  } catch {
    // Analytics must never break the page.
  }
}
