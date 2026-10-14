import { brand } from "@/config/brand";
import {
  buildPublicCohortListing,
  sortPublicCohortRows,
  type PublicCohortRow,
} from "@/lib/publicCohorts";
import { isUpcomingPublicCohort } from "@/lib/publicCohortVisibility";

export const PUBLIC_COHORTS_ALLOWED_ORIGINS = [
  brand.urls.site,
  brand.urls.siteWww,
  "http://localhost:3025",
] as const;

export const PUBLIC_COHORTS_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

const PUBLIC_COHORTS_BASE_URL = brand.urls.hub;
const CURRENCY = "usd";

export interface PublicCohortPrice {
  amount: number;
  currency: string;
}

export interface PublicCohortTicket {
  label: string;
  mode: "online" | "in_person";
  price: PublicCohortPrice;
  capacity: number | null;
  seatsLeft: number | null;
}

export interface PublicCohortsFeedItem {
  slug: string;
  title: string;
  url: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  sessionCount: number;
  deliveryMode: string;
  location: string | null;
  certificate: boolean;
  priceFrom: PublicCohortPrice | null;
  tickets: PublicCohortTicket[];
}

export interface PublicCohortsFeed {
  generatedAt: string;
  cohorts: PublicCohortsFeedItem[];
}

export interface PublicCohortsHandlerDependencies {
  loadRows: (now: Date) => Promise<readonly PublicCohortRow[]>;
  now: () => Date;
}

export interface PublicCohortsHandlers {
  GET: (request: Request) => Promise<Response>;
  OPTIONS: (request: Request) => Response;
}

function toDateOnly(isoDate: string | null): string | null {
  return isoDate?.slice(0, 10) ?? null;
}

function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function buildPublicCohortsFeed(
  rows: readonly PublicCohortRow[],
  now: Date
): PublicCohortsFeed {
  const cohorts = sortPublicCohortRows(rows)
    .filter(isUpcomingPublicCohort)
    .map((row): PublicCohortsFeedItem => {
      const cohort = buildPublicCohortListing(row, false, now);
      const publicIdentifier = cohort.slug ?? cohort.id;
      const tickets = cohort.tiers.map((tier): PublicCohortTicket => ({
        label: tier.name,
        mode: tier.inPerson ? "in_person" : "online",
        price: { amount: toMinorUnits(tier.price), currency: CURRENCY },
        capacity: tier.inPerson ? tier.seats : null,
        seatsLeft: tier.inPerson ? tier.seatsLeft : null,
      }));
      const lowestPrice = tickets.length
        ? Math.min(...tickets.map((ticket) => ticket.price.amount))
        : null;

      // Keep this projection field-by-field: the source rows deliberately carry
      // more page data than the cross-origin API contract permits.
      return {
        slug: publicIdentifier,
        title: cohort.title,
        url: `${PUBLIC_COHORTS_BASE_URL}/cohorts/${publicIdentifier}`,
        startDate: toDateOnly(cohort.startDate),
        endDate: toDateOnly(cohort.endDate),
        startTime: cohort.startTime,
        endTime: cohort.endTime,
        timezone: cohort.timezone,
        sessionCount: cohort.schedule.length,
        deliveryMode: cohort.deliveryMode,
        location: cohort.location,
        certificate: cohort.certificate,
        priceFrom:
          lowestPrice === null ? null : { amount: lowestPrice, currency: CURRENCY },
        tickets,
      };
    });

  return { generatedAt: now.toISOString(), cohorts };
}

function responseHeaders(request: Request, cacheControl: string): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": cacheControl,
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  if (
    origin &&
    PUBLIC_COHORTS_ALLOWED_ORIGINS.includes(
      origin as (typeof PUBLIC_COHORTS_ALLOWED_ORIGINS)[number]
    )
  ) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function createPublicCohortsHandlers(
  dependencies: PublicCohortsHandlerDependencies
): PublicCohortsHandlers {
  return {
    async GET(request: Request): Promise<Response> {
      try {
        const now = dependencies.now();
        const rows = await dependencies.loadRows(now);
        return Response.json(buildPublicCohortsFeed(rows, now), {
          headers: responseHeaders(request, PUBLIC_COHORTS_CACHE_CONTROL),
        });
      } catch (error) {
        console.error("[public cohorts] unavailable", error);
        return Response.json(
          { error: "unavailable" },
          {
            status: 500,
            headers: responseHeaders(request, "no-store"),
          }
        );
      }
    },

    OPTIONS(request: Request): Response {
      return new Response(null, {
        status: 204,
        headers: responseHeaders(request, "no-store"),
      });
    },
  };
}
