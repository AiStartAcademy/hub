import type { JSX } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/client";

import { brand, brandFullAddress } from "@/config/brand";
import { prisma } from "@/lib/prisma";
import { sanitizeDescription } from "@/lib/sanitize";
import { formatVenueEventTypeLabel } from "@/lib/venueEventTypeLabels";
import { VenueEventRegistrationForm } from "@/components/venue/VenueEventRegistrationForm";
import {
  parseAgenda,
  parseFaq,
  parseGallery,
  parseHosts,
  parsePricingTiers,
} from "@/lib/venueEventContent";
import {
  formatEventDateRange,
  isEventPast,
  resolveEventInstants,
} from "@/lib/venueEventTime";
import { googleCalendarTemplateUrl } from "@/lib/venueEventIcs";
import {
  EventAgenda,
  EventFaq,
  EventGallery,
  EventHosts,
  EventPricing,
  EventVideo,
  formatPrice,
} from "@/components/venue/event/EventSections";
import { EventShareRow } from "@/components/venue/event/EventShareRow";

export const dynamic = "force-dynamic";

const SITE_URL = brand.urls.hub;
const VENUE_ADDRESS = brandFullAddress;
const EVENT_STATUSES = { APPROVED: "APPROVED", CANCELLED: "CANCELLED" } as const;
const REGISTRATION_STATUSES = ["CONFIRMED", "PENDING_PAYMENT"] as const;

const publicVenueEventSelect = {
  id: true,
  slug: true,
  title: true,
  type: true,
  description: true,
  subtitle: true,
  organizerName: true,
  orgName: true,
  date: true,
  endDate: true,
  startTime: true,
  endTime: true,
  timezone: true,
  capacity: true,
  status: true,
  cover: true,
  gallery: true,
  videoUrl: true,
  agenda: true,
  hosts: true,
  pricingTiers: true,
  priceNote: true,
  faq: true,
  externalRegistrationUrl: true,
  ticketPriceCents: true,
  isOnline: true,
} satisfies Prisma.VenueEventSelect;

type PublicVenueEvent = Prisma.VenueEventGetPayload<{ select: typeof publicVenueEventSelect }>;

function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * The page lede, and the meta description. `subtitle` is the authored one-liner;
 * falling back to the stripped body is what the page did before, but it now only
 * feeds metadata, so the visible lede is never a truncated copy of the text
 * sitting directly beneath it.
 */
function buildDescription(event: PublicVenueEvent | null): string {
  if (event?.subtitle) return truncate(event.subtitle, 160);
  const plainText = stripHtml(event?.description);
  if (plainText) return truncate(plainText, 160);
  return `Join ${brand.wordmark} for an upcoming community event in ${brand.address.city} or online.`;
}

async function getPublicEvent(slug: string): Promise<PublicVenueEvent | null> {
  const event = await prisma.venueEvent.findUnique({
    where: { slug },
    select: publicVenueEventSelect,
  });

  // Cancelled events stay reachable so an existing link explains itself rather
  // than 404ing; everything else must be APPROVED to be public.
  if (!event) return null;
  if (event.status !== EVENT_STATUSES.APPROVED && event.status !== EVENT_STATUSES.CANCELLED) {
    return null;
  }
  return event;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  let event: PublicVenueEvent | null = null;

  try {
    event = await getPublicEvent(slug);
  } catch {
    event = null;
  }

  if (!event) {
    return { title: `Event — ${brand.wordmark}`, robots: { index: false, follow: false } };
  }

  const description = buildDescription(event);
  const url = `${SITE_URL}/events/${slug}`;
  const images = [event.cover, ...parseGallery(event.gallery).map((image) => image.url)]
    .filter((src): src is string => Boolean(src))
    .slice(0, 4)
    .map((src) => ({ url: src, alt: event.title }));

  return {
    title: `${event.title} — ${brand.wordmark}`,
    description,
    alternates: { canonical: `/events/${slug}` },
    openGraph: {
      title: `${event.title} — ${brand.wordmark}`,
      description,
      url,
      type: "website",
      images: images.length ? images : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<JSX.Element> {
  const { slug } = await params;
  const event = await getPublicEvent(slug);

  if (!event) notFound();

  const reservedCount =
    event.capacity == null
      ? null
      : await prisma.venueEventRegistration.count({
          where: { venueEventId: event.id, status: { in: [...REGISTRATION_STATUSES] } },
        });

  const seatsLeft =
    event.capacity == null || reservedCount == null
      ? null
      : Math.max(event.capacity - reservedCount, 0);

  const gallery = parseGallery(event.gallery);
  const agenda = parseAgenda(event.agenda);
  const hosts = parseHosts(event.hosts);
  const tiers = parsePricingTiers(event.pricingTiers);
  const faq = parseFaq(event.faq);

  const instants = resolveEventInstants(event);
  const isPast = isEventPast(event);
  const isCancelled = event.status === EVENT_STATUSES.CANCELLED;
  const metaDescription = buildDescription(event);
  const eventUrl = `${SITE_URL}/events/${event.slug}`;
  const safeDescription = sanitizeDescription(event.description);

  // The .ics itself is served by ./event.ics/route.ts; only the Google
  // Calendar template URL has to be built inline for the share row.
  const googleCalendarUrl = googleCalendarTemplateUrl({
    ...event,
    summaryText: metaDescription,
    url: eventUrl,
  });

  // Tiers, when present, are the real prices; ticketPriceCents is the single-price case.
  const priceLabel = tiers.length
    ? `${formatPrice(Math.min(...tiers.map((tier) => tier.priceCents)))}–${formatPrice(
        Math.max(...tiers.map((tier) => tier.priceCents))
      )}`
    : formatPrice(event.ticketPriceCents);

  const offerUrl = event.externalRegistrationUrl ?? eventUrl;
  const availability =
    seatsLeft === 0 ? "https://schema.org/SoldOut" : "https://schema.org/InStock";

  // Always emit an Offer — a free event with no `offers` node can't be shown as
  // free in search results, which is why the previous version showed nothing.
  const offers = tiers.length
    ? tiers.map((tier) => ({
        "@type": "Offer",
        name: tier.label,
        price: (tier.priceCents / 100).toFixed(2),
        priceCurrency: "USD",
        availability: tier.soldOut ? "https://schema.org/SoldOut" : availability,
        url: tier.url ?? offerUrl,
      }))
    : {
        "@type": "Offer",
        price: ((event.ticketPriceCents ?? 0) / 100).toFixed(2),
        priceCurrency: "USD",
        availability,
        url: offerUrl,
      };

  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: metaDescription,
    startDate: instants.startIsoLocal,
    endDate: instants.endIsoLocal,
    eventStatus: isCancelled
      ? "https://schema.org/EventCancelled"
      : "https://schema.org/EventScheduled",
    eventAttendanceMode: event.isOnline
      ? "https://schema.org/OnlineEventAttendanceMode"
      : "https://schema.org/OfflineEventAttendanceMode",
    location: event.isOnline
      ? { "@type": "VirtualLocation", url: eventUrl }
      : {
          "@type": "Place",
          name: brand.wordmark,
          address: {
            "@type": "PostalAddress",
            streetAddress: brand.address.street,
            addressLocality: brand.address.city,
            addressRegion: brand.address.region,
            postalCode: brand.address.postalCode,
            addressCountry: brand.address.country,
          },
        },
    image: [event.cover, ...gallery.map((image) => image.url)].filter(Boolean),
    organizer: { "@type": "Organization", name: brand.wordmark, url: SITE_URL },
    performer: hosts.length
      ? hosts.map((host) => ({ "@type": "Person", name: host.name }))
      : undefined,
    url: eventUrl,
    offers,
  };

  const faqSchema = faq.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      }
    : null;

  const showRegistration = !isPast && !isCancelled;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify([eventSchema, faqSchema].filter(Boolean)) }}
        type="application/ld+json"
      />

      <Link className="text-sm text-slate-500 hover:text-primary" href="/events">
        ← All events
      </Link>

      {event.cover ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element -- covers come from
              arbitrary media-library / CDN hosts, not next.config images.remotePatterns */}
          <img
            alt={event.title}
            className="h-full max-h-[420px] w-full object-cover"
            src={event.cover}
          />
        </div>
      ) : null}

      {isCancelled ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5">
          <p className="font-semibold text-rose-900">This event has been cancelled.</p>
        </div>
      ) : isPast ? (
        <div className="rounded-3xl border border-slate-200 bg-slate-100 p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="font-semibold text-slate-900 dark:text-white">This event has happened.</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {gallery.length ? "Photos from the night are below." : null}{" "}
            <Link className="text-primary hover:underline" href="/events">
              See what&apos;s coming up next →
            </Link>
          </p>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="space-y-10">
          <header className="space-y-4">
            <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium uppercase tracking-[0.16em] text-emerald-800">
              {formatVenueEventTypeLabel(event.type)}
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">
              {event.title}
            </h1>
            {event.subtitle ? (
              <p className="text-lg leading-8 text-slate-600 dark:text-slate-400">
                {event.subtitle}
              </p>
            ) : null}
          </header>

          <dl className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <dt className="text-sm font-medium uppercase tracking-[0.14em] text-slate-500">
                Date
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900 dark:text-white">
                {formatEventDateRange(event)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium uppercase tracking-[0.14em] text-slate-500">
                Time
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900 dark:text-white">
                {event.startTime} – {event.endTime} PT
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium uppercase tracking-[0.14em] text-slate-500">
                Location
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900 dark:text-white">
                {event.isOnline ? (
                  "Online"
                ) : (
                  <address className="not-italic">{VENUE_ADDRESS}</address>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium uppercase tracking-[0.14em] text-slate-500">
                Price
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900 dark:text-white">
                {priceLabel}
                {event.priceNote && !tiers.length ? (
                  <span className="block text-sm font-normal text-slate-500">
                    {event.priceNote}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          {safeDescription ? (
            <section className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                About this event
              </h2>
              <div
                className="prose prose-slate max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: safeDescription }}
              />
            </section>
          ) : null}

          <EventVideo title={event.title} videoUrl={event.videoUrl} />
          <EventAgenda items={agenda} />
          <EventPricing priceNote={event.priceNote} tiers={tiers} />
          <EventGallery images={gallery} />
          <EventHosts
            fallbackOrganizer={{ organizerName: event.organizerName, orgName: event.orgName }}
            hosts={hosts}
          />
          <EventFaq entries={faq} />

          <EventShareRow
            eventUrl={eventUrl}
            googleCalendarUrl={googleCalendarUrl}
            icsHref={`/events/${event.slug}/event.ics`}
            title={event.title}
          />
        </div>

        <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-24 dark:border-slate-800 dark:bg-slate-900">
          {showRegistration ? (
            <>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">Register</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {seatsLeft === null
                    ? "Open registration."
                    : seatsLeft === 0
                      ? "Sold out."
                      : `${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left.`}
                </p>
              </div>

              <div className="mt-6">
                {seatsLeft === 0 ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <p className="text-sm font-semibold text-rose-900">Sold out</p>
                    <p className="mt-2 text-sm leading-6 text-rose-800">
                      This event has reached capacity. Email{" "}
                      <a className="underline" href={`mailto:${brand.email.contact}`}>
                        {brand.email.contact}
                      </a>{" "}
                      to be added to the waitlist.
                    </p>
                  </div>
                ) : event.externalRegistrationUrl ? (
                  <div className="space-y-4">
                    <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
                      Registration for this event is handled on an external site.
                    </p>
                    <Link
                      className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                      href={event.externalRegistrationUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Register
                    </Link>
                  </div>
                ) : (
                  <VenueEventRegistrationForm
                    isOnline={event.isOnline}
                    seatsLeft={seatsLeft}
                    slug={event.slug}
                    ticketPriceCents={event.ticketPriceCents}
                    waiverVersion="2026-08-04"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
                {isCancelled ? "Cancelled" : "Registration closed"}
              </h2>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                {isCancelled
                  ? "This event is no longer taking place."
                  : "This event has already happened."}
              </p>
              <Link
                className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                href="/events"
              >
                See upcoming events
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
