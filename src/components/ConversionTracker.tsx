"use client";
// Fires a GA4 `purchase` event once when a Stripe Checkout returns to a success
// URL (?checkout=success for a cohort, ?checkout=success&kind=course for a
// self-paced course, or ?membership=success for the membership).
// The Stripe webhook remains the SOURCE OF TRUTH for granting access — this only
// records the conversion for analytics. `transaction_id` (the Stripe session id,
// passed as `sid`) lets GA4 dedupe if the page is reloaded; we also strip the
// tracking params after firing so a manual refresh can't re-push.
//
// It also records the OTHER outcome: Stripe's cancel_url (?checkout=cancelled,
// with kind=course for a self-paced course).
// Without it, the funnel shows begin_checkout → purchase with the drop-off
// invisible, and there is no way to see whether a checkout UI change made
// people bail. The abandonment itself is still recovered server-side by the
// cart-recovery drip; this is measurement only.
import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { fbqTrack } from "@/lib/metaPixel";

export default function ConversionTracker() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const isCheckoutSuccess = q.get("checkout") === "success";
    const isMembership = q.get("membership") === "success";
    const isCourse = q.get("kind") === "course";
    const cancelled =
      q.get("checkout") === "cancelled" || q.get("membership") === "cancelled";

    if (cancelled) {
      let conversionKind = isCourse ? "course" : "cohort";
      if (q.get("membership") === "cancelled") {
        conversionKind = "membership";
      }
      trackEvent("checkout_cancelled", {
        conversion_kind: conversionKind,
      });
      ["checkout", "membership", "kind"].forEach((k) => q.delete(k));
      const cancelQs = q.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (cancelQs ? `?${cancelQs}` : "")
      );
      return;
    }

    if (!isCheckoutSuccess && !isMembership) return;

    const amt = Number(q.get("amt"));
    const sid = q.get("sid") || undefined;
    let conversionKind = isCourse ? "course" : "cohort";
    if (isMembership) {
      conversionKind = "membership";
    }
    trackEvent("purchase", {
      transaction_id: sid,
      value: Number.isFinite(amt) ? amt : undefined,
      currency: "USD",
      conversion_kind: conversionKind,
    });
    // Browser twin of the webhook's CAPI Purchase — same eventID (the Stripe
    // session id) so Meta counts the sale once whichever copy arrives first.
    fbqTrack(
      "Purchase",
      { value: Number.isFinite(amt) ? amt : 0, currency: "USD" },
      sid
    );

    ["checkout", "membership", "kind", "sid", "amt", "guest"].forEach((k) =>
      q.delete(k)
    );
    const qs = q.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "")
    );
  }, []);

  return null;
}
