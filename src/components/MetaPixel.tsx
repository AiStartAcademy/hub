"use client";
// Meta (Facebook) Pixel, loaded directly in code rather than via GTM — the GTM
// container only forwards `ui_click`, and config drift there is exactly what
// left Meta blind to conversions (see src/lib/serverConversions.ts header).
//
// The pixel id comes from /api/meta-pixel (Settings → Integrations →
// META_PIXEL_ID, env fallback), so enabling or rotating the pixel needs no
// rebuild and no k8s change. Renders nothing until an id is configured.
//
// What loading the pixel buys beyond PageView counts: the pixel writes the
// `_fbp` cookie (and `_fbc` on fbclid landings), which the checkout routes
// ferry through Stripe metadata so the webhook's CAPI Purchase arrives with
// strong match identifiers instead of just a hashed email.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import {
  CONSENT_CHANGE_EVENT,
  getConsent,
  type ConsentStatus,
} from "@/lib/cookieConsent";
import { shouldLoadMetaPixel } from "@/lib/metaPixel";

export default function MetaPixel() {
  const pathname = usePathname();
  const [pixelId, setPixelId] = useState<string | null>(null);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>("unset");
  const initialPathTracked = useRef(false);

  useEffect(() => {
    const syncConsent = () => setConsentStatus(getConsent());
    syncConsent();
    window.addEventListener(CONSENT_CHANGE_EVENT, syncConsent);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, syncConsent);
  }, []);

  useEffect(() => {
    if (!shouldLoadMetaPixel(consentStatus)) return;
    let cancelled = false;
    fetch("/api/meta-pixel")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { pixelId?: string | null } | null) => {
        if (!cancelled && data?.pixelId) setPixelId(data.pixelId);
      })
      .catch(() => {
        // No pixel is a valid state; the CAPI copy still reports conversions.
      });
    return () => {
      cancelled = true;
    };
  }, [consentStatus]);

  // The base snippet fires PageView for the landing page; fire it again on
  // client-side route changes so SPA navigation is not invisible to Meta.
  useEffect(() => {
    if (!shouldLoadMetaPixel(consentStatus)) return;
    if (!initialPathTracked.current) {
      initialPathTracked.current = true; // base snippet covers the first page
      return;
    }
    const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
    if (typeof fbq === "function") fbq("track", "PageView");
  }, [consentStatus, pathname]);

  if (!pixelId || !shouldLoadMetaPixel(consentStatus)) return null;

  return (
    <Script id="meta-pixel-init" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(pixelId)});
fbq('track', 'PageView');`}
    </Script>
  );
}
