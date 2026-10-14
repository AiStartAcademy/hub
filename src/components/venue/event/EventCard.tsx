// src/components/venue/event/EventCard.tsx
//
// Shared card for the events index and the calendar's day detail, so the two
// surfaces can't drift. Cover-image first: the old text-only card gave a
// visitor no reason to click.

import type { JSX } from "react";
import Link from "next/link";

import { formatVenueEventTypeLabel } from "@/lib/venueEventTypeLabels";
import { formatEventDateRange } from "@/lib/venueEventTime";
import { formatPrice } from "@/components/venue/event/EventSections";

export type EventCardData = {
  slug: string;
  title: string;
  subtitle?: string | null;
  orgName?: string | null;
  type: string;
  date: Date;
  endDate?: Date | null;
  cover?: string | null;
  ticketPriceCents?: number | null;
};

export function EventCard({ event }: { event: EventCardData }): JSX.Element {
  const isFree = !event.ticketPriceCents || event.ticketPriceCents <= 0;

  return (
    <article className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <Link className="flex flex-col sm:flex-row" href={`/events/${event.slug}`}>
        {event.cover ? (
          <div className="shrink-0 overflow-hidden bg-slate-100 sm:w-64 dark:bg-slate-800">
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN hosts */}
            <img
              alt=""
              className="aspect-video h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              loading="lazy"
              src={event.cover}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-6">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">
            {formatEventDateRange(event, { style: "short" })}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
            {event.title}
          </h2>
          {event.subtitle ? (
            <p className="line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {event.subtitle}
            </p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
            <span>{formatVenueEventTypeLabel(event.type)}</span>
            {event.orgName ? <span>· {event.orgName}</span> : null}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                isFree
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {formatPrice(event.ticketPriceCents ?? null)}
            </span>
          </p>
        </div>
      </Link>
    </article>
  );
}
