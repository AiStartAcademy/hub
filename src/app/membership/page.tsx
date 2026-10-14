// src/app/membership/page.tsx
// Public membership landing page. Server-rendered marketing shell; the tier cards
// (src/components/MembershipPlans.tsx) are the only client island, because they
// start Stripe checkout. No auth required — guests can subscribe and Stripe
// collects their email.
import Link from "next/link";
import { brand, brandStreetCity } from "@/config/brand";
import { content } from "@/config/content";
import { MembershipPlans } from "@/components/MembershipPlans";
import {
  MEMBERSHIP_TIER_CONFIG,
  MEMBERSHIP_TIERS,
} from "@/lib/membershipTiers";
import { featuredTestimonials } from "@/lib/testimonials";
import { membershipMetadata } from "@/lib/publicMetadata";

// Root layout applies the academy-name title template.
export const metadata = membershipMetadata;

const formatPrice = (amountCents: number) => `$${(amountCents / 100).toLocaleString("en-US")}`;

const SELF_PACED_PRICE = formatPrice(content.selfPacedProgram.priceCents);

function renderMembershipCopy(value: string): string {
  const recordings = MEMBERSHIP_TIER_CONFIG.MENTOR_NETWORK;
  return value
    .replaceAll("{{SELF_PACED_PRICE}}", SELF_PACED_PRICE)
    .replaceAll("{{RECORDINGS_PRICE}}", recordings ? formatPrice(recordings.amountCents) : "")
    .replaceAll("{{BRAND_NAME}}", brand.name)
    .replaceAll("{{NEIGHBORHOOD}}", brand.venue.neighborhood)
    .replaceAll("{{CONTACT_EMAIL}}", brand.email.contact);
}

const PERKS = content.membershipPage.perks.map((perk) => {
  const tierConfig = MEMBERSHIP_TIER_CONFIG[perk.tierId];
  return {
    ...perk,
    alt: renderMembershipCopy(perk.alt),
    tier: tierConfig
      ? perk.tierId === "MENTOR_NETWORK"
        ? `Recordings · ${formatPrice(tierConfig.amountCents)}/mo`
        : tierConfig.label
      : "",
  };
});

const FAQ = content.membershipPage.faq.map((item) => ({
  q: renderMembershipCopy(item.question),
  a: renderMembershipCopy(item.answer),
}));

export default function MembershipPage() {
  if (MEMBERSHIP_TIERS.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
        <div className="max-w-lg text-center">
          <h1 className="text-3xl font-black text-slate-900 dark:text-white">Membership</h1>
          <p className="mt-4 text-slate-600 dark:text-slate-300">
            No membership plans are available yet.
          </p>
          <Link href="/" className="mt-6 inline-block font-semibold text-primary hover:underline">
            Return to {brand.name}
          </Link>
        </div>
      </main>
    );
  }

  const recordings = MEMBERSHIP_TIER_CONFIG.MENTOR_NETWORK;
  const accelerator = MEMBERSHIP_TIER_CONFIG.ACCELERATOR;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Header — matches the standalone public pages (terms, privacy) */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link
            href="/"
            className="flex min-h-[44px] items-center rounded text-base font-bold text-slate-900 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary dark:text-white md:text-lg"
          >
            ← {brand.name}
          </Link>
          <nav className="flex gap-3 text-sm md:gap-6">
            <Link
              href="/cohorts"
              className="flex min-h-[44px] items-center rounded text-slate-500 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              Cohorts
            </Link>
            <Link
              href="/membership"
              className="flex min-h-[44px] items-center rounded font-semibold text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              Membership
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-background-dark">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-40 h-[560px] w-[560px] rounded-full bg-primary/15 blur-3xl"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-light" />
                Membership · {brand.address.city} &amp; online
              </p>
              <h1 className="mt-6 text-4xl font-black leading-[1.05] tracking-tight text-white md:text-5xl lg:text-6xl">
                Stay current.{" "}
                <span className="bg-gradient-to-r from-primary-light to-primary bg-clip-text text-transparent">
                  Build with our mentors.
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
                Two memberships, two jobs. Once you know the material, stay
                current as each new cohort runs. Learning it for the first
                time? Start with the{" "}
                <Link
                  href="/self-paced"
                  className="text-primary underline underline-offset-4 transition hover:brightness-110"
                >
                  {content.selfPacedProgram.name}
                </Link>
                . When you&rsquo;re building your own business, the Accelerator
                gives you the mentors, the space and the studio to do it with.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#plans"
                  className="inline-flex min-h-[48px] items-center rounded-full bg-gradient-to-r from-primary-light to-primary px-8 font-semibold text-background-dark transition hover:brightness-110"
                >
                  See both tiers
                </a>
                <a
                  href="#faq"
                  className="inline-flex min-h-[48px] items-center rounded-full border border-white/25 px-8 font-semibold text-white transition hover:border-primary hover:text-primary"
                >
                  Common questions
                </a>
              </div>
              <p className="mt-8 border-t border-white/10 pt-6 text-sm text-slate-400">
                From{" "}
                <span className="font-semibold text-primary">
                  ${recordings.amountCents / 100}/month
                </span>{" "}
                · cancel anytime · {brandStreetCity}
              </p>
            </div>
            <div className="relative">
              {/* Local static asset — plain <img> keeps next/image remote config out of it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/api/media/media/marketing/membership/previews/hero-workshop.jpg"
                alt={`A full room at an ${brand.name} session in ${brand.address.city}`}
                className="w-full rounded-2xl shadow-2xl shadow-black/50"
              />
              <div className="absolute -bottom-5 -left-5 hidden rounded-xl bg-white p-4 shadow-xl sm:block dark:bg-card-dark">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  Two tiers
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Stay current, or build with mentors
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Plans */}
        <section id="plans" className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">
            Choose your tier
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
            Learn it, then build with it
          </h2>
          <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">
            Both memberships are monthly and cancel anytime. The recordings
            membership keeps graduates current; the Accelerator is for
            building a business with close support. Still learning the
            material? Start with the{" "}
            <Link
              href="/self-paced"
              className="font-medium text-accent underline underline-offset-4 transition hover:brightness-110 dark:text-primary"
            >
              self-paced course
            </Link>{" "}
            for {SELF_PACED_PRICE}, one payment.
          </p>
          <div className="mt-10">
            <MembershipPlans />
          </div>
        </section>

        {/* Perks */}
        <section className="border-y border-border bg-white py-20 dark:border-border-dark dark:bg-slate-900">
          <div className="mx-auto max-w-6xl px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">
              What you actually get
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
              Membership, concretely
            </h2>
            <div className="mt-12 space-y-16">
              {PERKS.map((perk, i) => (
                <div
                  key={perk.title}
                  className="grid items-center gap-8 md:grid-cols-2 md:gap-12"
                >
                  <div className={i % 2 === 1 ? "md:order-2" : ""}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={perk.image}
                      alt={perk.alt}
                      loading="lazy"
                      className="h-72 w-full rounded-2xl object-cover shadow-lg"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-accent dark:text-primary">
                        {perk.eyebrow}
                      </span>
                      <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {perk.tier}
                      </span>
                    </div>
                    <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                      {perk.title}
                    </h3>
                    <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">
                      {perk.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Social proof */}
        {featuredTestimonials.length > 0 && (
          <section className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">
              From the room
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
              What people say after a cohort
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {featuredTestimonials.slice(0, 3).map((t) => (
                <figure
                  key={t.youtubeId}
                  className="rounded-2xl border border-border bg-white p-7 shadow-sm dark:border-border-dark dark:bg-card-dark"
                >
                  <blockquote className="text-slate-700 dark:text-slate-200">
                    “{t.quote}”
                  </blockquote>
                  <figcaption className="mt-5 border-t border-border pt-4 text-sm dark:border-border-dark">
                    {t.name && (
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {t.name}
                      </span>
                    )}
                    <span className="block text-slate-500 dark:text-slate-400">
                      {t.role}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* FAQ / objections */}
        <section
          id="faq"
          className="border-t border-border bg-white py-20 dark:border-border-dark dark:bg-slate-900"
        >
          <div className="mx-auto max-w-3xl px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">
              Before you join
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
              The questions people actually ask
            </h2>
            <div className="mt-10 divide-y divide-border border-t border-border dark:divide-border-dark dark:border-border-dark">
              {FAQ.map((item) => (
                <details key={item.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900 dark:text-white [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span className="text-xl font-normal text-accent transition-transform group-open:rotate-45 dark:text-primary">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden bg-background-dark py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-24 bottom-[-40%] h-[520px] w-[520px] rounded-full bg-accent/25 blur-3xl"
          />
          <div className="relative mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-3xl font-black tracking-tight text-white md:text-4xl">
              Pick the tier that matches where you are
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">
              Keeping current? {recordings.cardTitle} at $
              {recordings.amountCents / 100}/mo — new cohort recordings,
              refreshed materials and ongoing Q&amp;A. Building your own
              business? {accelerator.cardTitle} at $
              {accelerator.amountCents / 100}/mo — unlimited mentorship, the
              space and the studio. Both cancel anytime.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="#plans"
                className="inline-flex min-h-[48px] items-center rounded-full bg-gradient-to-r from-primary-light to-primary px-8 font-semibold text-background-dark transition hover:brightness-110"
              >
                Join now
              </a>
              <a
                href={`mailto:${brand.email.contact}`}
                className="inline-flex min-h-[48px] items-center rounded-full border border-white/25 px-8 font-semibold text-white transition hover:border-primary hover:text-primary"
              >
                Ask us a question
              </a>
            </div>
            <p className="mt-8 text-sm text-slate-400">
              {brandStreetCity} · {brand.email.contact}
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-slate-50 py-10 dark:border-border-dark dark:bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-slate-500 dark:text-slate-400">
          <span>© {new Date().getFullYear()} {brand.name}</span>
          <nav className="flex gap-5">
            <Link href="/cohorts" className="hover:text-primary">
              Cohorts
            </Link>
            <Link href="/terms" className="hover:text-primary">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-primary">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
