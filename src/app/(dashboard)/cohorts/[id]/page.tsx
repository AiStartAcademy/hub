// src/app/(dashboard)/cohorts/[id]/page.tsx
// Server SELECTOR for the cohort detail (View convention — docs/features/VIEWS.md).
// Resolves the viewer's audience and renders the mapped view:
//   manager / enrolled member → ManageView (the full client workspace)
//   guest / not-enrolled       → PublicView (indexable, convert → checkout)
import type { Metadata } from "next";
import { brand } from "@/config/brand";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sanitizeDescription } from "@/lib/sanitize";
import { resolveCohortAudience, isWorkspaceAudience } from "@/lib/audience";
import { groupSeatInclude, seatsLeft } from "@/lib/seats";
import { getCohortSeriesOccurrences } from "@/lib/seriesSchedule";
import { resolvePersonContact } from "@/lib/leads/personRecord";
import { cohortUpdatesBannerState } from "@/lib/cohortMessages/bannerState";
import { CohortUpdatesBanner } from "@/components/cohorts/CohortUpdatesBanner";
import ManageView from "./views/ManageView";
import PublicView, { type PublicCohortDetail } from "./views/PublicView";

const PUBLIC_STATUSES = ["ENROLLMENT", "IN_PROGRESS", "COMPLETE"];
const SITE = brand.urls.hub;

type Params = { params: Promise<{ id: string }> };

// Business-day count for short spans; weeks for longer ones (matches the list page).
function durationLabel(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return null;
  const calDays = Math.round(ms / 86_400_000) + 1;
  if (calDays <= 14) {
    let biz = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) biz++;
    }
    return `${biz} day${biz === 1 ? "" : "s"}`;
  }
  return `${Math.ceil(calDays / 7)} weeks`;
}

function fetchCohort(idOrSlug: string) {
  return prisma.cohort.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      groups: {
        orderBy: { price: "asc" },
        // Seats taken = members + live pending reservations (see lib/seats.ts).
        include: groupSeatInclude(),
      },
      instructors: { select: { id: true, name: true, image: true, bio: true } },
      sessions: {
        orderBy: { order: "asc" },
        select: { title: true, date: true, startTime: true, endTime: true, timezone: true },
      },
    },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const c = await prisma.cohort.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: { id: true, slug: true, title: true, description: true, status: true, cover: true },
  });
  if (!c) return { title: "Cohort" };
  const url = `/cohorts/${c.slug || c.id}`;
  const desc = c.description
    ? c.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 155)
    : `Join the ${c.title} cohort at ${brand.name} — in-person in ${brand.address.city} + Zoom.`;
  return {
    title: c.title,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      title: `${c.title} — ${brand.name}`,
      description: desc,
      url,
      type: "website",
      ...(c.cover ? { images: [c.cover] } : {}),
    },
    robots: { index: PUBLIC_STATUSES.includes(c.status), follow: true },
  };
}

export default async function CohortDetailPage({ params }: Params) {
  const { id } = await params;
  const cohort = await fetchCohort(id);
  if (!cohort) notFound();
  const now = new Date();

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const enrolled = userId
    ? (await prisma.groupMember.count({ where: { userId, group: { cohortId: cohort.id } } })) > 0 ||
      (await prisma.enrollment.count({ where: { userId, cohortId: cohort.id } })) > 0
    : false;

  const audience = resolveCohortAudience(session, { enrolled });

  // Managers get the workspace without student consent prompts.
  if (audience === "manager") {
    return <ManageView />;
  }

  if (audience === "member" && userId) {
    const personContact = await resolvePersonContact(userId);
    const bannerFields = personContact
      ? await prisma.contact.findUnique({
          where: { id: personContact.id },
          select: {
            courseEmailOptOutAt: true,
            cohortBannerDismissedAt: true,
          },
        })
      : null;
    const bannerState = cohortUpdatesBannerState(
      personContact
        ? {
            phone: personContact.phone,
            smsMarketingConsentAt: personContact.smsMarketingConsentAt,
            smsTransactionalConsentAt: personContact.smsTransactionalConsentAt,
            smsOptOutAt: personContact.smsOptOutAt,
            courseEmailOptOutAt: bannerFields?.courseEmailOptOutAt ?? null,
            cohortBannerDismissedAt: bannerFields?.cohortBannerDismissedAt ?? null,
          }
        : null,
      cohort,
      now
    );

    return (
      <>
        {(bannerState.showEmail || bannerState.showSms) && (
          <CohortUpdatesBanner
            cohortName={cohort.title}
            showEmail={bannerState.showEmail}
            showSms={bannerState.showSms}
          />
        )}
        <ManageView />
      </>
    );
  }

  // Defensive fallback: every workspace audience is handled above.
  if (isWorkspaceAudience(audience)) return <ManageView />;

  // Guests / non-enrolled students get the public view — only for publicly visible cohorts.
  if (!PUBLIC_STATUSES.includes(cohort.status)) notFound();

  const tiers = cohort.groups.map((g) => ({
    id: g.id,
    name: g.name,
    inPerson: g.inPerson,
    price: g.price,
    seats: g.seats,
    seatsLeft: seatsLeft(g),
  }));
  const prices = tiers.map((t) => t.price).filter((p) => p > 0);
  const dur = durationLabel(cohort.startDate, cohort.endDate);

  // Shared check-ins are SeriesOccurrence rows, not this cohort's own sessions.
  // Fetch from now (the schedule only lists what's still ahead) and cap at the
  // cohort's end date so a rolling series doesn't swamp a three-week cohort.
  const sharedOccurrences = await getCohortSeriesOccurrences(cohort.id, { from: now });
  const cohortEnd = cohort.endDate?.getTime() ?? Infinity;
  const boundedShared = sharedOccurrences.filter((o) => o.date.getTime() <= cohortEnd);

  const detail: PublicCohortDetail = {
    id: cohort.id,
    slug: cohort.slug,
    title: cohort.title,
    descriptionHtml: sanitizeDescription(cohort.description),
    cover: cohort.cover,
    status: cohort.status,
    deliveryMode: cohort.deliveryMode,
    location: cohort.location,
    startDate: cohort.startDate ? cohort.startDate.toISOString() : null,
    endDate: cohort.endDate ? cohort.endDate.toISOString() : null,
    startTime: cohort.startTime,
    endTime: cohort.endTime,
    timezone: cohort.timezone,
    durationLabel: dur,
    tools: cohort.tools,
    certificate: cohort.certificate,
    leadMagnet: cohort.leadMagnet,
    leadMagnetCta: cohort.leadMagnetCta,
    instructors: cohort.instructors,
    // Future sessions only, soonest first — recurring cohorts (the Q&A) keep every
    // past occurrence in `sessions`, and their DB `order` doesn't track date.
    schedule: [
      ...cohort.sessions.map((s) => ({
        title: s.title,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        timezone: s.timezone,
        shared: false,
      })),
      // Shared check-in calls this cohort attends alongside the others running that
      // week. Bounded to the cohort's own date range: a rolling series runs for
      // months, and listing all of it would drown the cohort's actual schedule.
      ...boundedShared.map((o) => ({
        title: o.context,
        date: o.date,
        startTime: o.startTime,
        endTime: o.endTime,
        timezone: o.timezone,
        shared: true,
      })),
    ]
      .filter((s) => !s.date || s.date.getTime() >= now.getTime())
      .sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity))
      .map((s) => ({
        title: s.title,
        date: s.date ? s.date.toISOString() : null,
        startTime: s.startTime,
        endTime: s.endTime,
        // The zone the session actually runs in — the view formats per viewer.
        timezone: s.timezone,
        shared: s.shared,
      })),
    tiers,
    fromPrice: prices.length ? Math.min(...prices) : 0,
  };

  const url = `${SITE}/cohorts/${cohort.slug || cohort.id}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${cohort.title}${dur ? ` — ${dur}` : ""}`,
    ...(cohort.startDate ? { startDate: cohort.startDate.toISOString() } : {}),
    ...(cohort.endDate ? { endDate: cohort.endDate.toISOString() } : {}),
    eventAttendanceMode:
      cohort.deliveryMode === "INPERSON"
        ? "https://schema.org/OfflineEventAttendanceMode"
        : cohort.deliveryMode === "HYBRID"
          ? "https://schema.org/MixedEventAttendanceMode"
          : "https://schema.org/OnlineEventAttendanceMode",
    location: cohort.location
      ? { "@type": "Place", name: cohort.location }
      : { "@type": "VirtualLocation", url },
    organizer: { "@type": "Organization", name: brand.wordmark, url: brand.urls.site },
    ...(detail.fromPrice
      ? { offers: { "@type": "Offer", price: detail.fromPrice, priceCurrency: "USD", url } }
      : {}),
    url,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicView cohort={detail} />
    </>
  );
}
