// GET /events/[slug]/event.ics — calendar download for a public event.

import { NextResponse } from "next/server";

import { brand } from "@/config/brand";
import { prisma } from "@/lib/prisma";
import { buildVenueEventIcs } from "@/lib/venueEventIcs";

export const dynamic = "force-dynamic";

function stripHtml(input: string | null): string {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await params;

  const event = await prisma.venueEvent.findUnique({
    where: { slug },
    select: {
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      date: true,
      endDate: true,
      startTime: true,
      endTime: true,
      timezone: true,
      isOnline: true,
      status: true,
    },
  });

  // Same visibility rule as the page: only APPROVED events are downloadable.
  if (!event || event.status !== "APPROVED") {
    return new NextResponse("Not found", { status: 404 });
  }

  const summaryText = event.subtitle ?? (stripHtml(event.description).slice(0, 400) || null);

  const body = buildVenueEventIcs({
    ...event,
    summaryText,
    url: `${brand.urls.hub}/events/${event.slug}`,
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}.ics"`,
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
