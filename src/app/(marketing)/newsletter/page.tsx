// src/app/(marketing)/newsletter/page.tsx
//
// The shareable newsletter signup page — a link that can go in a bio, a talk
// slide, or a post. Lives in the (marketing) group so it inherits the public,
// indexable chrome rather than the LMS sidebar.
import type { JSX } from "react";
import type { Metadata } from "next";

import { brand } from "@/config/brand";
import { NewsletterSignup } from "@/components/NewsletterSignup";

const PAGE_URL = `${brand.urls.hub}/newsletter`;
const META_DESCRIPTION =
  `Updates from ${brand.name}: what we're learning building and shipping AI systems, and what's worth your attention. No fixed schedule, no filler.`;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Newsletter",
  description: META_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: `Newsletter — ${brand.name}`,
    description: META_DESCRIPTION,
    url: PAGE_URL,
  },
  robots: { index: true, follow: true },
};

const WHAT_YOU_GET = [
  "What we're actually building — the systems, the tools we kept, the ones we dropped.",
  "The parts of this work that don't show up in demos: what breaks, and what it costs.",
  "First word on new workshops, sessions, and anything we open up at the SF space.",
];

export default function NewsletterPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-6 md:py-24">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl dark:text-white">
        Notes from the workshop floor
      </h1>
      <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
        We teach people to deploy AI, not to study it. This is where we write down what that
        actually looks like week to week — sent when there&apos;s something worth the
        interruption, not on a schedule.
      </p>

      <ul className="mt-8 space-y-3">
        {WHAT_YOU_GET.map((item) => (
          <li key={item} className="flex gap-3 text-slate-600 dark:text-slate-300">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-10">
        <NewsletterSignup />
      </div>

      <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
        One click unsubscribes you, from any email we send. We don&apos;t share your address.
      </p>
    </div>
  );
}
