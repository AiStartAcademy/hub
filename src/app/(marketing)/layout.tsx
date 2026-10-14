// src/app/(marketing)/layout.tsx
//
// Public, indexable chrome for guest-facing pages. Event pages used to live in
// the (dashboard) group, which meant a marketing landing page rendered inside
// the LMS sidebar — and inherited that layout's `robots: noindex`. This group
// exists so a visitor arriving from the calendar, Luma, or search gets a real
// page. Deliberately no `auth()` call: these routes are public and must render
// identically signed in or out.

import type { Metadata } from "next";
import Link from "next/link";

import { brand, brandFullAddress } from "@/config/brand";
import NewsletterSignup from "@/components/NewsletterSignup";
import ThemeToggle from "@/components/ThemeToggle";
import ConversionTracker from "@/components/ConversionTracker";

// The root layout already opts these in; stated explicitly so a future edit to
// the root doesn't silently de-index the public event pages.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link
            href="/"
            className="flex min-h-[44px] items-center rounded text-base font-bold tracking-tight text-slate-900 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary md:text-lg dark:text-white"
          >
            {brand.wordmark}
          </Link>
          <nav className="flex gap-4 text-sm md:gap-6">
            <Link
              href="/events"
              className="flex min-h-[44px] items-center rounded text-slate-500 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              Events
            </Link>
            <Link
              href="/calendar"
              className="flex min-h-[44px] items-center rounded text-slate-500 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              Calendar
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-20 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl border-b border-slate-200 px-4 py-10 md:px-6 dark:border-slate-800">
          <NewsletterSignup
            variant="inline"
            heading={`Get updates from ${brand.name}`}
            blurb="What we're building, what we're teaching, and what's opening up at the SF space."
          />
        </div>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-sm text-slate-500 md:flex-row md:items-center md:justify-between md:px-6">
          <p>
            {brand.wordmark} · {brandFullAddress} ·{" "}
            <a className="hover:text-primary" href={`mailto:${brand.email.contact}`}>
              {brand.email.contact}
            </a>
          </p>
          <nav className="flex gap-4">
            <Link className="hover:text-primary" href="/newsletter">
              Newsletter
            </Link>
            <Link className="hover:text-primary" href="/terms">
              Terms
            </Link>
            <Link className="hover:text-primary" href="/privacy">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>

      <ThemeToggle />
      <ConversionTracker />
    </div>
  );
}
