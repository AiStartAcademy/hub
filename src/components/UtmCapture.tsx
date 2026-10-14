"use client";

import { useEffect } from "react";
import {
  ATTRIBUTION_COOKIE,
  parseAttribution,
  hasAttribution,
} from "@/lib/attribution";

/**
 * Captures marketing attribution on landing.
 *
 * On first arrival from an ad/email/social link (which carries utm_* and/or a
 * click id like fbclid), this writes a FIRST-TOUCH cookie that survives the
 * whole session — so even after the visitor clicks through a multi-step quiz
 * (and the URL params are gone), the server can still attach the original
 * source to the lead/response at submit time.
 *
 * First-touch semantics: we do NOT overwrite an existing attribution cookie, so
 * the very first campaign that brought the visitor in is the one that gets
 * credit. The cookie also feeds GTM/GA via the same values already in the URL.
 */
export default function UtmCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const parsed = parseAttribution(params);
      if (!hasAttribution(parsed)) return;

      // First-touch: keep the earliest attribution if one already exists.
      const alreadySet = document.cookie
        .split("; ")
        .some((c) => c.startsWith(`${ATTRIBUTION_COOKIE}=`));
      if (alreadySet) return;

      const attribution = {
        ...parsed,
        referrer: document.referrer || undefined,
        landing_page: window.location.pathname,
        captured_at: new Date().toISOString(),
      };

      const value = encodeURIComponent(JSON.stringify(attribution));
      const maxAge = 60 * 60 * 24 * 90; // 90 days
      document.cookie = `${ATTRIBUTION_COOKIE}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;

      // Also surface it to GTM/GA for real-time reporting.
      (window as unknown as { dataLayer?: unknown[] }).dataLayer =
        (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
      (window as unknown as { dataLayer: unknown[] }).dataLayer.push({
        event: "attribution_captured",
        ...attribution,
      });
    } catch {
      // Attribution is best-effort; never break the page over it.
    }
  }, []);

  return null;
}
