import type { JSX } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/client";

import { brand } from "@/config/brand";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { EventCard } from "@/components/venue/event/EventCard";

export const dynamic = "force-dynamic";

const upcomingEventSelect = {
  slug: true,
  title: true,
  subtitle: true,
  orgName: true,
  type: true,
  date: true,
  endDate: true,
  cover: true,
  ticketPriceCents: true,
} satisfies Prisma.VenueEventSelect;

type UpcomingEvent = Prisma.VenueEventGetPayload<{
  select: typeof upcomingEventSelect;
}>;

export const metadata: Metadata = {
  title: `Events — ${brand.wordmark}`,
  description: `Browse upcoming ${brand.wordmark} events in ${brand.address.city} and online.`,
  alternates: {
    canonical: "/events",
  },
  robots: {
    index: true,
    follow: true,
  },
};

function getUtcMidnightToday(): Date {
  const now = new Date();

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function EmptyState(): JSX.Element {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <h2 className="text-2xl font-semibold text-slate-950">No upcoming events yet</h2>
      <p className="mt-3 text-base text-slate-600">
        Check the full venue calendar for the latest activity.
      </p>
      <Link
        className="mt-6 inline-flex rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        href="/calendar"
      >
        View calendar
      </Link>
    </div>
  );
}

export default async function EventsPage(): Promise<JSX.Element> {
  let events: UpcomingEvent[] = [];

  try {
    events = await prisma.venueEvent.findMany({
      where: {
        status: "APPROVED",
        // A multi-day event is still upcoming on its second morning, so it
        // qualifies on either its start day or its end day.
        OR: [
          { date: { gte: getUtcMidnightToday() } },
          { endDate: { gte: getUtcMidnightToday() } },
        ],
      },
      orderBy: {
        date: "asc",
      },
      select: upcomingEventSelect,
    });
  } catch (error) {
    logger.error(
      error instanceof Error
        ? `Failed to load public venue events index: ${error.message}`
        : "Failed to load public venue events index"
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          Upcoming events
        </h1>
        <p className="max-w-3xl text-lg text-slate-600">
          Workshops, meetups, demos, and community gatherings from {brand.wordmark}.
        </p>
      </section>

      {events.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="grid gap-4">
          {events.map((event) => (
            <EventCard event={event} key={event.slug} />
          ))}
        </section>
      )}
    </main>
  );
}
