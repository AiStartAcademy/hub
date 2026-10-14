// src/app/unsubscribe/page.tsx
// Public one-click unsubscribe target for drip email footers.
//
// This intentionally acts on GET. A confirmation button would be more RESTful and
// would also mean a real person who wants out has to click twice — worse for both
// deliverability and decency. The token is a 24-byte random secret scoped to one
// contact, and the only thing it can do is suppress mail, so acting on GET costs
// nothing an attacker would want. Repeat visits are idempotent.

import Link from "next/link";
import { brand } from "@/config/brand";
import { unsubscribeByToken } from "@/lib/drip/engine";
import { parseEmailScopeParam } from "@/lib/drip/emailScope";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `Unsubscribe | ${brand.name}`,
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; scope?: string }>;
}) {
  const { token, scope: scopeParam } = await searchParams;
  const scope = parseEmailScopeParam(scopeParam);
  const result = token
    ? await unsubscribeByToken(token, scope)
    : { ok: false as const };

  const { heading, message } = result.ok
    ? scope === "course"
      ? {
          heading: "You're unsubscribed from course updates",
          message:
            "You won't get course update emails for your cohorts. You may miss schedule changes. You can turn them back on in Settings.",
        }
      : {
          heading: result.alreadyDone ? "You're already unsubscribed" : "You're unsubscribed",
          message: `We won't send any more nurture email to ${result.email}. You'll still get receipts and account messages if you sign up for a cohort.`,
        }
    : {
        heading: "That link didn't work",
        message:
          `The unsubscribe link is invalid or expired. Email ${brand.email.contact} and we'll take you off the list by hand.`,
      };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
          {brand.wordmark}
        </p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">{heading}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {message}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/cohorts"
            className="inline-flex items-center rounded-lg bg-slate-900 dark:bg-white px-4 py-2.5 text-sm font-bold text-white dark:text-slate-900 hover:opacity-90 transition-opacity"
          >
            Browse cohorts
          </Link>
          <a
            href={`mailto:${brand.email.contact}`}
            className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Contact us
          </a>
        </div>
      </div>
    </main>
  );
}
