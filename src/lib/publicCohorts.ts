import { seatsLeft } from "@/lib/seats";
import { sanitizeDescription } from "@/lib/sanitize";

export interface PublicCohortGroupRow {
  id: string;
  name: string;
  inPerson: boolean;
  price: number;
  seats: number;
  _count: { members: number };
  payments: { id: string }[];
}

export interface PublicCohortSessionRow {
  title: string;
  startTime: string | null;
  timezone: string | null;
}

export interface PublicCohortInstructorRow {
  id: string;
  name: string | null;
  image: string | null;
  slug: string | null;
  profileVisibility: string;
}

/**
 * The complete database boundary used by both the public page and JSON feed.
 * Private cohort, enrollment, payment, meeting, and member fields never enter it.
 */
export interface PublicCohortRow {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  cover: string | null;
  status: string;
  deliveryMode: string;
  location: string | null;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  tools: string | null;
  certificate: boolean;
  leadMagnet: boolean;
  leadMagnetCta: string | null;
  instructors: PublicCohortInstructorRow[];
  sessions: PublicCohortSessionRow[];
  groups: PublicCohortGroupRow[];
}

export interface PublicSession {
  title: string;
  startTime: string | null;
  timezone: string | null;
}

export interface PublicInstructor {
  id: string;
  name: string | null;
  image: string | null;
  slug: string | null;
  profileVisibility: string;
}

export interface PublicCohort {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  cover: string | null;
  status: string;
  deliveryMode: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  tools: string | null;
  certificate: boolean;
  leadMagnet: boolean;
  leadMagnetCta: string | null;
  durationLabel: string | null;
  fromPrice: number;
  isEnrolled: boolean;
  instructors: PublicInstructor[];
  schedule: PublicSession[];
  tiers: Array<{
    id: string;
    name: string;
    inPerson: boolean;
    price: number;
    seats: number;
    seatsLeft: number;
  }>;
}

// Business-day count for short spans; weeks for longer ones.
function durationLabel(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return null;
  const calendarDays = Math.round(ms / 86_400_000) + 1;
  if (calendarDays <= 14) {
    let businessDays = 0;
    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const dayOfWeek = day.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) businessDays += 1;
    }
    return `${businessDays} day${businessDays === 1 ? "" : "s"}`;
  }
  return `${Math.ceil(calendarDays / 7)} weeks`;
}

function upcomingSessions(
  sessions: readonly PublicCohortSessionRow[],
  now: Date
): PublicSession[] {
  const timestamp = (session: PublicCohortSessionRow): number | null => {
    const parsed = session.startTime ? new Date(session.startTime).getTime() : Number.NaN;
    return Number.isNaN(parsed) ? null : parsed;
  };

  return sessions
    .filter((session) => {
      const sessionTimestamp = timestamp(session);
      return sessionTimestamp === null || sessionTimestamp >= now.getTime();
    })
    .sort(
      (left, right) =>
        (timestamp(left) ?? Number.POSITIVE_INFINITY) -
        (timestamp(right) ?? Number.POSITIVE_INFINITY)
    )
    .map((session) => ({
      title: session.title,
      startTime: session.startTime,
      timezone: session.timezone,
    }));
}

export function sortPublicCohortRows(rows: readonly PublicCohortRow[]): PublicCohortRow[] {
  return [...rows].sort((left, right) => {
    if (!left.startDate && !right.startDate) return 0;
    if (!left.startDate) return 1;
    if (!right.startDate) return -1;
    return left.startDate.getTime() - right.startDate.getTime();
  });
}

export function buildPublicCohortListing(
  cohort: PublicCohortRow,
  isEnrolled: boolean,
  now: Date
): PublicCohort {
  const tiers = cohort.groups.map((group) => ({
    id: group.id,
    name: group.name,
    inPerson: group.inPerson,
    price: group.price,
    seats: group.seats,
    seatsLeft: seatsLeft(group),
  }));
  // Preserve the page's existing "from" behavior: free-only/no-ticket cohorts
  // display Free, while a mixed free/paid cohort advertises its paid offer.
  const paidPrices = tiers.map((tier) => tier.price).filter((price) => price > 0);

  return {
    id: cohort.id,
    slug: cohort.slug,
    title: cohort.title,
    description: sanitizeDescription(cohort.description),
    cover: cohort.cover,
    status: cohort.status,
    isEnrolled,
    deliveryMode: cohort.deliveryMode,
    location: cohort.location,
    startDate: cohort.startDate?.toISOString() ?? null,
    endDate: cohort.endDate?.toISOString() ?? null,
    startTime: cohort.startTime,
    endTime: cohort.endTime,
    timezone: cohort.timezone,
    tools: cohort.tools,
    certificate: cohort.certificate,
    leadMagnet: cohort.leadMagnet,
    leadMagnetCta: cohort.leadMagnetCta,
    durationLabel: durationLabel(cohort.startDate, cohort.endDate),
    fromPrice: paidPrices.length ? Math.min(...paidPrices) : 0,
    instructors: cohort.instructors.map((instructor) => ({
      id: instructor.id,
      name: instructor.name,
      image: instructor.image,
      slug: instructor.slug,
      profileVisibility: instructor.profileVisibility,
    })),
    schedule: upcomingSessions(cohort.sessions, now),
    tiers,
  };
}
