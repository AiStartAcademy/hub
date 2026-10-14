// src/components/venue/event/EventSections.tsx
//
// Server components for the public event landing page. Every section renders
// nothing when it has no content, so a bare event (title + date) still produces
// a clean page and gains sections as content is filled in — the quiz-night
// event ships without photos and gains a gallery later with no code change.

import type { JSX } from "react";
import Link from "next/link";

import { brand } from "@/config/brand";
import {
  groupAgendaByDay,
  youTubeEmbedUrl,
  type AgendaItem,
  type EventHost,
  type FaqEntry,
  type GalleryImage,
  type PricingTier,
} from "@/lib/venueEventContent";

export function formatPrice(ticketPriceCents: number | null | undefined): string {
  if (!ticketPriceCents || ticketPriceCents <= 0) return "Free";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    ticketPriceCents / 100
  );
}

function SectionHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
      {children}
    </h2>
  );
}

/** "2026-09-12" → "Saturday, September 12". Parsed as UTC so it can't drift a day. */
function formatDayHeading(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(parsed);
}

// ─── gallery ───────────────────────────────────────────────────────

export function EventGallery({ images }: { images: GalleryImage[] }): JSX.Element | null {
  if (!images.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeading>Photos</SectionHeading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image, index) => (
          <figure
            key={`${image.url}-${index}`}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- gallery URLs are
                arbitrary media-library / CDN hosts, not in next.config images.remotePatterns */}
            <img
              alt={image.alt ?? ""}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
              src={image.url}
            />
            {image.caption ? (
              <figcaption className="px-3 py-2 text-xs text-slate-500">{image.caption}</figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </section>
  );
}

// ─── video ─────────────────────────────────────────────────────────

export function EventVideo({
  videoUrl,
  title,
}: {
  videoUrl: string | null;
  title: string;
}): JSX.Element | null {
  // Only a validated YouTube id ever reaches the iframe — never the raw URL.
  const embedUrl = youTubeEmbedUrl(videoUrl);
  if (!embedUrl) return null;

  return (
    <section className="space-y-4">
      <SectionHeading>Watch</SectionHeading>
      <div className="aspect-video overflow-hidden rounded-3xl border border-slate-200 bg-black dark:border-slate-800">
        <iframe
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          src={embedUrl}
          title={`${title} — video`}
        />
      </div>
    </section>
  );
}

// ─── agenda ────────────────────────────────────────────────────────

export function EventAgenda({ items }: { items: AgendaItem[] }): JSX.Element | null {
  if (!items.length) return null;
  const days = groupAgendaByDay(items);

  return (
    <section className="space-y-4">
      <SectionHeading>Schedule</SectionHeading>
      <div className="space-y-6">
        {days.map((day, dayIndex) => (
          <div key={`${day.date ?? "undated"}-${dayIndex}`} className="space-y-3">
            {day.date || day.label ? (
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
                {day.label ?? formatDayHeading(day.date!)}
              </h3>
            ) : null}
            <ol className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {day.items.map((item, index) => (
                <li
                  key={`${item.title}-${index}`}
                  className="flex flex-col gap-1 border-b border-slate-100 p-4 last:border-b-0 sm:flex-row sm:gap-6 dark:border-slate-800"
                >
                  <div className="w-full shrink-0 text-sm font-medium text-slate-500 sm:w-40">
                    {item.startTime
                      ? `${item.startTime}${item.endTime ? ` – ${item.endTime}` : ""}`
                      : null}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-slate-900 dark:text-white">
                      {item.title}
                      {item.isPublic ? (
                        <span className="ml-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                          Open to the public
                        </span>
                      ) : null}
                    </p>
                    {item.note ? (
                      <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {item.note}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── hosts ─────────────────────────────────────────────────────────

function HostLinks({ host }: { host: EventHost }): JSX.Element | null {
  const links = [
    host.links?.linkedin ? { label: "LinkedIn", href: host.links.linkedin } : null,
    host.links?.site ? { label: "Website", href: host.links.site } : null,
    host.links?.x ? { label: "X", href: host.links.x } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);

  if (!links.length) return null;

  return (
    <p className="flex flex-wrap gap-3 text-sm">
      {links.map((link) => (
        <a
          key={link.href}
          className="text-primary hover:underline"
          href={link.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {link.label}
        </a>
      ))}
    </p>
  );
}

export function EventHosts({
  hosts,
  fallbackOrganizer,
}: {
  hosts: EventHost[];
  /** Used when no structured hosts exist — every legacy event has only these strings. */
  fallbackOrganizer: { organizerName: string; orgName: string | null };
}): JSX.Element {
  if (!hosts.length) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <SectionHeading>Organizer</SectionHeading>
        <p className="mt-3 text-base leading-7 text-slate-700 dark:text-slate-300">
          Hosted by {fallbackOrganizer.organizerName}
          {fallbackOrganizer.orgName ? ` from ${fallbackOrganizer.orgName}` : ""} in partnership
          with {brand.wordmark}.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <SectionHeading>{hosts.length > 1 ? "Your hosts" : "Your host"}</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        {hosts.map((host, index) => {
          const name = host.profileSlug ? (
            <Link className="hover:text-primary" href={`/humans/${host.profileSlug}`}>
              {host.name}
            </Link>
          ) : (
            host.name
          );

          return (
            <article
              key={`${host.name}-${index}`}
              className="flex gap-4 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              {host.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN hosts
                <img
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-full object-cover"
                  loading="lazy"
                  src={host.photoUrl}
                />
              ) : null}
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white">{name}</p>
                {host.role ? <p className="text-sm text-slate-500">{host.role}</p> : null}
                {host.bio ? (
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{host.bio}</p>
                ) : null}
                <HostLinks host={host} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─── pricing ───────────────────────────────────────────────────────

export function EventPricing({
  tiers,
  priceNote,
}: {
  tiers: PricingTier[];
  priceNote: string | null;
}): JSX.Element | null {
  if (!tiers.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeading>Pricing</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-3">
        {tiers.map((tier, index) => (
          <div
            key={`${tier.label}-${index}`}
            className={`rounded-3xl border p-5 ${
              tier.soldOut
                ? "border-slate-200 bg-slate-100 opacity-70 dark:border-slate-800 dark:bg-slate-900"
                : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            }`}
          >
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-slate-500">
              {tier.label}
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {formatPrice(tier.priceCents)}
            </p>
            {tier.note ? <p className="mt-2 text-sm text-slate-600">{tier.note}</p> : null}
            {tier.soldOut ? (
              <p className="mt-3 text-sm font-semibold text-rose-700">Sold out</p>
            ) : tier.url ? (
              <a
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                href={tier.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                Get this ticket
              </a>
            ) : null}
          </div>
        ))}
      </div>
      {priceNote ? <p className="text-sm text-slate-500">{priceNote}</p> : null}
    </section>
  );
}

// ─── faq ───────────────────────────────────────────────────────────

export function EventFaq({ entries }: { entries: FaqEntry[] }): JSX.Element | null {
  if (!entries.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeading>Questions</SectionHeading>
      <div className="divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {entries.map((entry, index) => (
          <details key={`${entry.q}-${index}`} className="group p-5">
            <summary className="cursor-pointer list-none font-medium text-slate-900 marker:hidden dark:text-white">
              {entry.q}
            </summary>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">{entry.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
