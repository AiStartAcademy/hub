// src/app/self-paced/page.tsx
// Public self-paced-course sales page. Server-rendered; the only client islands
// are BuyCourseButton, ConversionTracker, TestimonialsSection, and MembershipPlanCard.
// This page renders ConversionTracker itself because the root layout does not.
import { Fragment, type JSX } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BuyCourseButton } from "@/components/BuyCourseButton";
import ConversionTracker from "@/components/ConversionTracker";
import { MembershipPlanCard } from "@/components/MembershipPlans";
import TestimonialsSection from "@/components/TestimonialsSection";
import { brand, brandStreetCity } from "@/config/brand";
import { SELF_PACED_PROGRAM_ID } from "@/config/catalog";
import { content, type ContentSelfPacedTextSegment } from "@/config/content";
import { formatMonthlyPrice } from "@/lib/pricing";
import prisma from "@/lib/prisma";
import {
  getSelfPacedSectionVisibility,
  renderSelfPacedCopy,
  type SelfPacedCopyValues,
} from "@/lib/selfPacedSections";

const PAGE_URL = `${brand.urls.hub}/self-paced`;
const pageContent = content.selfPacedPage;
const pageTitle = pageContent.metadata.title || content.selfPacedProgram.name;

// Render per-request, never at build time. This page queries the DB, and the
// Docker/CI build stage has no DATABASE_URL — prerendering it there crashes the
// build because `src/lib/prisma.ts` eagerly constructs PrismaClient.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Root layout applies the academy-name title template.
  title: pageTitle,
  description: pageContent.metadata.description,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: `${pageTitle} — ${brand.name}`,
    description: pageContent.metadata.description,
    url: PAGE_URL,
    images: ["/api/media/media/marketing/membership/previews/hero-workshop.jpg"],
  },
};

/** Seconds → "1h 45m" / "45m". Returns null below one minute so nothing renders. */
function formatDuration(seconds: number): string | null {
  if (seconds < 60) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export default async function SelfPacedPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; guest?: string }>;
}): Promise<JSX.Element> {
  const { checkout, guest } = await searchParams;
  const isSuccess = checkout === "success";
  const isCancelled = checkout === "cancelled";
  // Guest checkout success URLs append `guest=1`; the cohort checkout uses the same convention.
  const isGuestPurchase = guest === "1";

  // Do not catch this query: a DB outage must surface as a real error, not a silent 404.
  const program = await prisma.program.findUnique({
    where: { id: SELF_PACED_PROGRAM_ID },
    select: {
      id: true,
      name: true,
      description: true,
      priceCents: true,
      modules: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          lessons: {
            orderBy: { order: "asc" },
            select: { id: true, name: true, duration: true },
          },
        },
      },
      materials: { select: { id: true, title: true, type: true } },
    },
  });

  if (!program) notFound();

  const lessons = program.modules.flatMap((module) => module.lessons);
  const totalSeconds = lessons.reduce((sum, lesson) => sum + lesson.duration, 0);
  const totalHours = Math.round(totalSeconds / 3600);
  const sessionCount = lessons.length;
  const priceCents = program.priceCents;
  const priceLabel =
    priceCents === null ? null : `$${(priceCents / 100).toLocaleString("en-US")}`;
  const recordingsTier = content.membershipTiers.find(
    (tier) => tier.id === "MENTOR_NETWORK",
  );
  const copyValues: SelfPacedCopyValues = {
    brandName: brand.name,
    city: brand.address.city,
    contactEmail: brand.email.contact,
    neighborhood: brand.venue.neighborhood,
    price: priceLabel ?? "",
    recordingsPrice: recordingsTier
      ? formatMonthlyPrice(recordingsTier.amountCents)
      : "",
    sessionCount,
    totalHours,
  };
  const copy = (value: string): string => renderSelfPacedCopy(value, copyValues);
  const sectionVisibility = getSelfPacedSectionVisibility(pageContent);
  const showStories =
    sectionVisibility.stories && pageContent.storiesHeading.trim() !== "";
  const renderSegments = (segments: readonly ContentSelfPacedTextSegment[]) =>
    segments.map((segment, index) =>
      segment.strong ? (
        <strong key={index}>{copy(segment.text)}</strong>
      ) : (
        <Fragment key={index}>{copy(segment.text)}</Fragment>
      ),
    );

  const courseSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: program.name,
    description: program.description ?? metadata.description,
    url: PAGE_URL,
    provider: {
      "@type": "EducationalOrganization",
      name: brand.name,
      url: brand.urls.site,
    },
    ...(priceCents === null
      ? {}
      : {
          offers: {
            "@type": "Offer",
            price: (priceCents / 100).toFixed(2),
            priceCurrency: "USD",
            url: PAGE_URL,
            availability: "https://schema.org/InStock",
            category: "Paid",
          },
        }),
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(courseSchema) }}
      />
      <ConversionTracker />

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
              href="/self-paced"
              className="flex min-h-[44px] items-center rounded font-semibold text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              Self-paced
            </Link>
            <Link
              href="/membership"
              className="flex min-h-[44px] items-center rounded text-slate-500 transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
            >
              Membership
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {isSuccess ? (
          <section className="relative overflow-hidden bg-background-dark">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -top-40 h-[560px] w-[560px] rounded-full bg-primary/15 blur-3xl"
            />
            <div className="relative mx-auto max-w-4xl px-6 py-20 lg:py-24">
              <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-light" />
                {copy(pageContent.success.badge)}
              </p>
              <h1 className="mt-6 text-4xl font-black leading-[1.05] tracking-tight text-white md:text-5xl lg:text-6xl">
                {copy(pageContent.success.title)}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
                {copy(pageContent.success.body)}
              </p>
              {isGuestPurchase && (
                <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-300">
                  {copy(pageContent.success.guestBody)}
                </p>
              )}
              <Link
                href={`/courses/${program.id}`}
                className="mt-8 inline-flex min-h-[48px] items-center rounded-full bg-gradient-to-r from-primary-light to-primary px-8 font-semibold text-background-dark transition hover:brightness-110"
              >
                {copy(pageContent.success.courseCta)}
              </Link>
              <div className="mt-10 grid gap-5 border-t border-white/10 pt-8 md:grid-cols-2">
                <div>
                  <h2 className="font-bold text-white">{copy(pageContent.success.checkInTitle)}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {copy(pageContent.success.checkInBody)}
                  </p>
                </div>
                <div>
                  <h2 className="font-bold text-white">{copy(pageContent.success.guaranteeTitle)}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {copy(pageContent.success.guaranteeBody)}
                  </p>
                </div>
              </div>
              <p className="mt-8 text-sm leading-relaxed text-slate-400">
                {copy(pageContent.success.membershipBody)}
              </p>
            </div>
          </section>
        ) : (
          <>
            {isCancelled && (
              <div className="border-y border-border bg-surface dark:border-border-dark dark:bg-slate-900">
                <p className="mx-auto max-w-6xl px-6 py-3 text-sm text-slate-600 dark:text-slate-300">
                  {copy(pageContent.cancelledMessage)}
                </p>
              </div>
            )}
            <section className="relative overflow-hidden bg-background-dark">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-24 -top-40 h-[560px] w-[560px] rounded-full bg-primary/15 blur-3xl"
              />
              <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-24">
                <div>
                  <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary-light" />
                    {copy(pageContent.hero.badge)}
                  </p>
                  <h1 className="mt-6 text-4xl font-black leading-[1.05] tracking-tight text-white md:text-5xl lg:text-6xl">
                    {copy(pageContent.hero.title)}{" "}
                    <span className="bg-gradient-to-r from-primary-light to-primary bg-clip-text text-transparent">
                      {copy(pageContent.hero.titleAccent)}
                    </span>
                  </h1>
                  <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
                    {copy(pageContent.hero.description)}
                  </p>
                  <p className="mt-6 text-sm text-slate-400">
                    {priceLabel ? (
                      <>
                        <strong className="text-primary">{priceLabel}</strong>{" "}
                        {copy(pageContent.hero.priceSuffix)}
                      </>
                    ) : (
                      <>{copy(pageContent.hero.priceFallback)}</>
                    )}
                  </p>
                  <div className="mt-8 flex flex-wrap items-start gap-3">
                    <div className="w-full max-w-sm">
                      <BuyCourseButton
                        programId={program.id}
                        programName={program.name}
                        priceCents={priceCents}
                        label={priceLabel ? `${copy(pageContent.hero.primaryCta)} — ${priceLabel}` : copy(pageContent.hero.primaryCta)}
                        variant="onDark"
                      />
                    </div>
                    <a
                      href="#whats-inside"
                      className="inline-flex min-h-[48px] items-center rounded-full border border-white/25 px-8 font-semibold text-white transition hover:border-primary hover:text-primary"
                    >
                      {copy(pageContent.hero.secondaryCta)}
                    </a>
                  </div>
                </div>
                <div className="relative">
                  {/* Local static asset — plain <img> keeps next/image remote config out of it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/api/media/media/marketing/membership/previews/hero-workshop.jpg"
                    alt={copy(pageContent.hero.imageAlt)}
                    className="w-full rounded-2xl shadow-2xl shadow-black/50"
                  />
                </div>
              </div>
            </section>
          </>
        )}

        {pageContent.problem.title.trim() !== "" && (
        <section className="mx-auto max-w-4xl px-6 py-20">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">
            {copy(pageContent.problem.eyebrow)}
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
            {copy(pageContent.problem.title)}
          </h2>
          <div className="mt-8 space-y-5 text-lg leading-relaxed text-slate-600 dark:text-slate-300">
            {pageContent.problem.paragraphs.map((paragraph, index) => (
              <p key={index}>{renderSegments(paragraph.segments)}</p>
            ))}
          </div>
        </section>
        )}

        {pageContent.paths.title.trim() !== "" && pageContent.paths.cards.length > 0 && (
        <section className="border-y border-border bg-white py-20 dark:border-border-dark dark:bg-slate-900">
          <div className="mx-auto max-w-6xl px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{copy(pageContent.paths.eyebrow)}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">{copy(pageContent.paths.title)}</h2>
            <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{copy(pageContent.paths.intro)}</p>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {pageContent.paths.cards.map((card) => (
                <article key={card.title} className="rounded-2xl border border-border bg-white p-7 dark:border-border-dark dark:bg-card-dark">
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{copy(card.title)}</h3>
                  <p className="mt-4 leading-relaxed text-slate-600 dark:text-slate-300">{renderSegments(card.body)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        )}

        {pageContent.included.titleWithoutSessions.trim() !== "" && (
        <section id="whats-inside" className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{copy(pageContent.included.eyebrow)}</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
            {sessionCount > 0
              ? copy(pageContent.included.titleWithSessions)
              : copy(pageContent.included.titleWithoutSessions)}
          </h2>
          <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-300">
            {sessionCount > 0 && totalHours > 0
              ? copy(pageContent.included.descriptionWithHours)
              : copy(pageContent.included.descriptionWithoutHours)}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {pageContent.included.cards.map((card) => (
              <article key={card.title} className="rounded-2xl border border-border bg-white p-7 dark:border-border-dark dark:bg-card-dark">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{copy(card.title)}</h3>
                <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">{copy(card.body)}</p>
              </article>
            ))}
          </div>

          {sessionCount > 0 && (
            <div className="mt-14 space-y-10">
              {program.modules.map((module) => {
                if (module.lessons.length === 0) return null;
                return (
                  <div key={module.id}>
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{module.name}</h3>
                    <ol className="mt-4 divide-y divide-border border-y border-border dark:divide-border-dark dark:border-border-dark">
                      {module.lessons.map((lesson) => {
                        const lessonNumber =
                          lessons.findIndex((candidate) => candidate.id === lesson.id) + 1;
                        const duration = lesson.duration > 0 ? formatDuration(lesson.duration) : null;
                        return (
                          <li key={lesson.id} className="flex items-center gap-4 py-4">
                            <span className="font-mono text-sm font-bold text-accent dark:text-primary">{String(lessonNumber).padStart(2, "0")}</span>
                            <span className="flex-1 font-medium text-slate-900 dark:text-white">{lesson.name}</span>
                            {duration && <span className="text-right text-sm text-slate-500 dark:text-slate-400">{duration}</span>}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                );
              })}
            </div>
          )}

          {program.materials.length > 0 && (
            <div className="mt-12 rounded-2xl border border-border bg-white p-7 dark:border-border-dark dark:bg-card-dark">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{copy(pageContent.included.materialsHeading)}</h3>
              <ul className="mt-4 space-y-2 text-slate-600 dark:text-slate-300">
                {program.materials.map((material) => <li key={material.id}>• {material.title}</li>)}
              </ul>
            </div>
          )}
        </section>
        )}

        {pageContent.portfolio.title.trim() !== "" && pageContent.portfolio.steps.length > 0 && (
        <section className="border-y border-border bg-white py-20 dark:border-border-dark dark:bg-slate-900">
          <div className="mx-auto max-w-6xl px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{copy(pageContent.portfolio.eyebrow)}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">{copy(pageContent.portfolio.title)}</h2>
            <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{copy(pageContent.portfolio.intro)}</p>
            <ol className="mt-10 grid gap-3 md:grid-cols-2">
              {pageContent.portfolio.steps.map((step) => (
                <li key={step.number} className="flex gap-4 rounded-2xl border border-border bg-white p-5 dark:border-border-dark dark:bg-card-dark">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${step.checkpoint ? "bg-accent text-white" : "bg-surface text-accent dark:bg-slate-800 dark:text-primary"}`}>{step.number}</span>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{step.asset}</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">— {step.meaning}</p>
                  </div>
                </li>
              ))}
            </ol>
            <h3 className="mt-14 text-2xl font-bold text-slate-900 dark:text-white">{copy(pageContent.portfolio.milestonesHeading)}</h3>
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {pageContent.portfolio.milestones.map((milestone) => (
                <article key={milestone.title} className="rounded-2xl border border-border bg-white p-6 dark:border-border-dark dark:bg-card-dark">
                  <h4 className="font-bold text-slate-900 dark:text-white">{copy(milestone.title)}</h4>
                  <p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{copy(milestone.body)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        )}

        {pageContent.rationale.title.trim() !== "" && pageContent.rationale.paragraphs.length > 0 && (
        <section className="mx-auto max-w-4xl px-6 py-20">
          <div className="rounded-2xl border border-border border-l-4 border-l-accent bg-white p-8 dark:border-border-dark dark:border-l-accent dark:bg-card-dark">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{copy(pageContent.rationale.eyebrow)}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">{copy(pageContent.rationale.title)}</h2>
            <div className="mt-6 space-y-5 leading-relaxed text-slate-600 dark:text-slate-300">
              {pageContent.rationale.paragraphs.map((paragraph) => (
                <p key={paragraph}>{copy(paragraph)}</p>
              ))}
            </div>
          </div>
        </section>
        )}

        {pageContent.comparison.title.trim() !== "" && pageContent.comparison.options.length > 0 && (
        <section className="border-y border-border bg-white py-20 dark:border-border-dark dark:bg-slate-900">
          <div className="mx-auto max-w-6xl px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{copy(pageContent.comparison.eyebrow)}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">{copy(pageContent.comparison.title)}</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              <article className="relative rounded-2xl border border-accent bg-white p-7 ring-2 ring-accent dark:bg-card-dark">
                <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">{copy(pageContent.comparison.currentBadge)}</span>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">{copy(pageContent.comparison.selfPacedTitle)}</h3>
                <p className="mt-5 text-3xl font-black text-slate-900 dark:text-white">{priceLabel ?? copy(pageContent.comparison.priceFallback)}</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy(pageContent.comparison.oneTimeLabel)}</p>
                <p className="mt-5 leading-relaxed text-slate-600 dark:text-slate-300">{copy(pageContent.comparison.selfPacedBody)}</p>
              </article>
              {pageContent.comparison.options.map((option) => (
                <article key={option.title} className="rounded-2xl border border-border bg-white p-7 dark:border-border-dark dark:bg-card-dark">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{copy(option.title)}</h3>
                  <p className="mt-5 text-3xl font-black text-slate-900 dark:text-white">{copy(option.priceLabel)}</p>
                  <p className="mt-5 leading-relaxed text-slate-600 dark:text-slate-300">{copy(option.body)}</p>
                </article>
              ))}
            </div>
            {pageContent.comparison.outro.trim() !== "" && <p className="mt-8 text-slate-600 dark:text-slate-300">{copy(pageContent.comparison.outro)}</p>}
            {pageContent.comparison.datesPrefix.trim() !== "" && <p className="mt-3 text-slate-600 dark:text-slate-300">
              {copy(pageContent.comparison.datesPrefix)}{" "}
              <a href={brand.social.luma} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline dark:text-primary">{brand.social.lumaLabel}</a>.
            </p>}
          </div>
        </section>
        )}

        {(content.testimonials.length > 0 || showStories || sectionVisibility.testimonial) && (
        <section className="mx-auto max-w-6xl px-6 py-20">
          {content.testimonials.length > 0 && <TestimonialsSection />}
          {showStories && <div className={content.testimonials.length > 0 ? "mt-16" : ""}>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{copy(pageContent.storiesHeading)}</h3>
            <ul className="mt-6 grid gap-3 md:grid-cols-2">
              {pageContent.stories.map((story) => (
                <li key={story.text} className="rounded-2xl border border-border bg-white p-5 text-slate-600 dark:border-border-dark dark:bg-card-dark dark:text-slate-300">{copy(story.text)}</li>
              ))}
            </ul>
            {sectionVisibility.testimonial && pageContent.testimonial && (
            <blockquote className="mt-8 rounded-2xl border border-border bg-white p-7 text-lg leading-relaxed text-slate-700 dark:border-border-dark dark:bg-card-dark dark:text-slate-200">
              “{copy(pageContent.testimonial.quote)}”
              <footer className="mt-4 text-sm text-slate-500 dark:text-slate-400">— {copy(pageContent.testimonial.attribution)}</footer>
            </blockquote>
            )}
            {pageContent.storiesOutro.trim() !== "" && <p className="mt-6 text-slate-600 dark:text-slate-300">{copy(pageContent.storiesOutro)}</p>}
          </div>}
          {!showStories && sectionVisibility.testimonial && pageContent.testimonial && (
            <blockquote className={content.testimonials.length > 0 ? "mt-16 rounded-2xl border border-border bg-white p-7 text-lg leading-relaxed text-slate-700 dark:border-border-dark dark:bg-card-dark dark:text-slate-200" : "rounded-2xl border border-border bg-white p-7 text-lg leading-relaxed text-slate-700 dark:border-border-dark dark:bg-card-dark dark:text-slate-200"}>
              “{copy(pageContent.testimonial.quote)}”
              <footer className="mt-4 text-sm text-slate-500 dark:text-slate-400">— {copy(pageContent.testimonial.attribution)}</footer>
            </blockquote>
          )}
        </section>
        )}

        {sectionVisibility.stats && (
        <section className="border-y border-border bg-white dark:border-border-dark dark:bg-slate-900">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-4">
            {pageContent.stats.map((stat) => (
              <div key={stat.value}><p className="text-4xl font-black text-accent dark:text-primary">{copy(stat.value)}</p><p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{copy(stat.label)}</p></div>
            ))}
          </div>
        </section>
        )}

        {pageContent.guarantee.title.trim() !== "" && (
        <section className="bg-background-dark py-20">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{copy(pageContent.guarantee.eyebrow)}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-4xl">{copy(pageContent.guarantee.title)}</h2>
            <p className="mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-slate-300">{copy(pageContent.guarantee.body)}</p>
          </div>
        </section>
        )}

        {sectionVisibility.faq && pageContent.faqHeading.title.trim() !== "" && (
        <section id="faq" className="border-b border-border bg-white py-20 dark:border-border-dark dark:bg-slate-900">
          <div className="mx-auto max-w-3xl px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{copy(pageContent.faqHeading.eyebrow)}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">{copy(pageContent.faqHeading.title)}</h2>
            <div className="mt-10 divide-y divide-border border-t border-border dark:divide-border-dark dark:border-border-dark">
              {pageContent.faq.map((item) => (
                <details key={item.question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900 dark:text-white [&::-webkit-details-marker]:hidden">
                    {copy(item.question)}
                    <span className="text-xl font-normal text-accent transition-transform group-open:rotate-45 dark:text-primary">+</span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-300">{copy(totalHours > 0 || !item.answerWithoutHours ? item.answer : item.answerWithoutHours)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        )}

        {pageContent.membership.title.trim() !== "" && recordingsTier && (
        <section className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent dark:text-primary">{copy(pageContent.membership.eyebrow)}</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">{copy(pageContent.membership.title)}</h2>
          <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-300">{copy(pageContent.membership.body)}</p>
          <div className="mx-auto mt-10 max-w-md">
            <MembershipPlanCard tier="MENTOR_NETWORK" />
          </div>
        </section>
        )}

        {pageContent.closing.title.trim() !== "" && (
        <section className="relative overflow-hidden bg-background-dark py-20">
          <div aria-hidden="true" className="pointer-events-none absolute -left-24 bottom-[-40%] h-[520px] w-[520px] rounded-full bg-accent/25 blur-3xl" />
          <div className="relative mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-3xl font-black tracking-tight text-white md:text-4xl">{copy(pageContent.closing.title)}</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">
              {priceLabel
                ? copy(pageContent.closing.bodyWithPrice)
                : copy(pageContent.closing.bodyWithoutPrice)}
            </p>
            <div className="mx-auto mt-8 max-w-sm">
              <BuyCourseButton
                programId={program.id}
                programName={program.name}
                priceCents={priceCents}
                label={priceLabel ? `${copy(pageContent.closing.cta)} — ${priceLabel}` : copy(pageContent.closing.cta)}
                variant="onDark"
              />
            </div>
            <a href={`mailto:${brand.email.contact}`} className="mt-3 inline-flex min-h-[48px] items-center rounded-full border border-white/25 px-8 font-semibold text-white transition hover:border-primary hover:text-primary">{copy(pageContent.closing.contactCta)}</a>
            <p className="mt-8 text-sm text-slate-400">{brandStreetCity} · {brand.email.contact}</p>
          </div>
        </section>
        )}
      </main>

      <footer className="border-t border-border bg-slate-50 py-10 dark:border-border-dark dark:bg-slate-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-slate-500 dark:text-slate-400">
          <span>© {new Date().getFullYear()} {brand.name}</span>
          <nav className="flex gap-5">
            <Link href="/cohorts" className="hover:text-primary">Cohorts</Link>
            <Link href="/membership" className="hover:text-primary">Membership</Link>
            <Link href="/terms" className="hover:text-primary">Terms</Link>
            <Link href="/privacy" className="hover:text-primary">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
