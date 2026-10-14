"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Shield, X } from "lucide-react";
import { getConsent, setConsent } from "@/lib/cookieConsent";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only prompt while the choice is still "unset" — Consent Mode already
    // defaults to denied until then (see src/lib/consent.ts).
    if (getConsent() === "unset") {
      // Small delay for smoother appearance
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    setConsent("granted");
    setVisible(false);
  };

  // Also used by the close (X) button: dismissing without accepting is a
  // refusal, never an implied grant.
  const handleDecline = () => {
    setConsent("denied");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] animate-slide-up"
      role="dialog"
      aria-label="Cookie consent"
      id="cookie-consent-banner"
    >
      <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 shadow-2xl shadow-black/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Icon & Text */}
          <div className="flex items-start gap-3 flex-1">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 dark:bg-primary/20 text-primary flex items-center justify-center mt-0.5">
              <Shield className="w-5 h-5" />
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              <p className="font-semibold text-slate-900 dark:text-white mb-1">
                We value your privacy
              </p>
              <p>
                We use essential cookies to ensure our platform works properly
                and functional cookies to remember your preferences. With your
                consent we also use analytics and advertising cookies (Google
                Analytics and Meta) to measure how the site is used and how
                people find us. Decline and those stay off.{" "}
                <Link
                  href="/privacy"
                  className="text-primary hover:underline font-medium"
                >
                  Read our Privacy Policy
                </Link>
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto">
            <button
              onClick={handleDecline}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              id="cookie-decline-btn"
            >
              Decline Optional
            </button>
            <button
              onClick={handleAccept}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary hover:bg-primary-dark text-white transition-all shadow-lg shadow-primary/25"
              id="cookie-accept-btn"
            >
              Accept All
            </button>
            <button
              onClick={handleDecline}
              className="hidden sm:flex p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              aria-label="Close cookie banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
