import type { Metadata } from "next";
import { brand, brandFullAddress } from "@/config/brand";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import PublicVenueCalendar from "@/components/venue/PublicVenueCalendar";
import { resolveEventInstants } from "@/lib/venueEventTime";

export const dynamic = "force-dynamic";

const SITE_URL = brand.urls.hub;
const VENUE_NAME = brand.wordmark;
const VENUE_STREET = brand.address.street;
const VENUE_ADDRESS = brandFullAddress;

type VenueEventJsonLdRow = {
  id: string;
  slug: string | null;
  title: string;
  type: string;
  date: Date;
  endDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  isOnline: boolean;
  orgName: string | null;
  description: string | null;
};

export const metadata: Metadata = {
  title: "Venue Calendar",
  description:
    `Browse upcoming availability and community events at ${brand.wordmark}'s ${brand.address.city} venue.`,
  alternates: { canonical: "/calendar" },
  openGraph: {
    title: `Venue Calendar — ${brand.name}`,
    description:
      `See upcoming programming and partner community events at ${brand.wordmark}'s ${brand.address.city} venue.`,
    url: "/calendar",
    type: "website",
  },
  robots: { index: true, follow: true },
};

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function currentMonthKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function getApprovedVenueEvents(): Promise<VenueEventJsonLdRow[]> {
  try {
    return await prisma.venueEvent.findMany({
      where: {
        status: "APPROVED",
        date: { gte: todayUtc() },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        type: true,
        date: true,
        endDate: true,
        startTime: true,
        endTime: true,
        timezone: true,
        isOnline: true,
        orgName: true,
        description: true,
      },
    });
  } catch {
    logger.error("Failed to load approved venue events for /calendar JSON-LD.");
    return [];
  }
}

export default async function CalendarPage() {
  const venueEvents = await getApprovedVenueEvents();
  const graph = venueEvents.flatMap((event) => {
    if (!event.slug) {
      return [];
    }

    // Real start/end instants — a date-only startDate hides the actual time
    // from search, and online events were being marked as in-person.
    const instants = resolveEventInstants(event);

    return [
      {
        "@type": "Event" as const,
        name: event.title,
        startDate: instants.startIsoLocal,
        endDate: instants.endIsoLocal,
        location: event.isOnline
          ? {
              "@type": "VirtualLocation" as const,
              url: `${SITE_URL}/events/${event.slug}`,
            }
          : {
              "@type": "Place" as const,
              name: VENUE_NAME,
              address: {
                "@type": "PostalAddress" as const,
                streetAddress: VENUE_STREET,
                addressLocality: brand.address.city,
                addressRegion: brand.address.region,
                postalCode: brand.address.postalCode,
                addressCountry: brand.address.country,
              },
            },
        organizer: {
          "@type": "Organization" as const,
          name: VENUE_NAME,
          url: SITE_URL,
        },
        eventAttendanceMode: event.isOnline
          ? "https://schema.org/OnlineEventAttendanceMode"
          : "https://schema.org/OfflineEventAttendanceMode",
        url: `${SITE_URL}/events/${event.slug}`,
      },
    ];
  });
  const jsonLd =
    graph.length > 0
      ? {
          "@context": "https://schema.org",
          "@graph": graph,
        }
      : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div className="space-y-8">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Venue Calendar</h1>
          <p className="max-w-3xl text-sm leading-6 text-neutral-600 sm:text-base">
            The venue at {VENUE_ADDRESS} hosts {brand.wordmark} programming and partner
            community events. Browse upcoming dates here, and organizers can request a date
            for their own event.
          </p>
        </header>
        <PublicVenueCalendar initialMonth={currentMonthKey()} />
      </div>
    </>
  );
}
