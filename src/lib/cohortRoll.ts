import type { CohortCreateInput, CohortCreateResult } from "@/lib/cohortCreate";
import { createCohort as createCohortReal } from "@/lib/cohortCreate";
import prisma from "@/lib/prisma";

/**
 * The single place an admin edits when the standard Monday cohort offer changes.
 * Keep schedule, catalog, instructor, pricing, and onboarding defaults together
 * so a roll cannot silently combine settings from different cohort formats.
 */
export const MONDAY_COHORT_TEMPLATE = {
  titlePattern: "Monday Cohort — {date}",
  slugPrefix: "monday-cohort",
  deliveryMode: "ONLINE" as const,
  timezone: "America/Los_Angeles",
  programTitles: [] as string[],
  instructorEmails: [] as string[],
  groups: [
    {
      name: "General",
      price: 0,
      seats: 50,
      inPerson: false,
    },
  ],
  sessionDays: ["MON", "TUE", "WED", "THU", "FRI"] as const,
  startTime: "9:00 AM",
  endTime: "5:00 PM",
  onboardingSession: {
    title: "Cohort Onboarding",
    startTime: "9:00 AM",
    endTime: "10:00 AM",
  },
  cohortLengthDays: 5,
} as const;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface RollingCohort {
  id: string;
  slug?: string | null;
  title?: string;
  status?: string;
  startDate?: Date | null;
  groups?: unknown[];
}

type RollingCreateResult = CohortCreateResult | RollingCohort;

export interface CohortRollDeps {
  db?: typeof prisma;
  createCohort?: (
    input: CohortCreateInput
  ) => Promise<RollingCreateResult>;
}

export interface CohortRollOptions {
  weeks: number;
  now: Date;
}

export interface CohortRollResult {
  created: RollingCohort[];
  skipped: RollingCohort[];
  warnings: string[];
}

function calendarDateInTimeZone(date: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

function addUtcCalendarDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days)
  );
}

/**
 * Return date-only values encoded at UTC midnight. The weekday must come from
 * the Los Angeles calendar date, not from the source instant's UTC weekday: a
 * Sunday evening in California is already Monday in UTC. Intl supplies the PT
 * date without relying on the machine's locale or a hand-written DST offset.
 */
export function nextMondays(from: Date, count: number): Date[] {
  const { year, month, day } = calendarDateInTimeZone(
    from,
    MONDAY_COHORT_TEMPLATE.timezone
  );
  const ptCalendarDate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilMonday = (8 - ptCalendarDate.getUTCDay()) % 7;
  const firstMonday = addUtcCalendarDays(ptCalendarDate, daysUntilMonday);
  const mondayCount = Math.max(0, Math.floor(count));

  return Array.from({ length: mondayCount }, (_, index) =>
    addUtcCalendarDays(firstMonday, index * 7)
  );
}

/** Dates from nextMondays are canonical PT calendar dates encoded at UTC midnight. */
export function mondayCohortSlug(monday: Date): string {
  return `${MONDAY_COHORT_TEMPLATE.slugPrefix}-${monday
    .toISOString()
    .slice(0, 10)}`;
}

function cohortTitle(monday: Date): string {
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(monday);

  return MONDAY_COHORT_TEMPLATE.titlePattern.replace("{date}", dateLabel);
}

function createdCohort(result: RollingCreateResult): RollingCohort {
  return "cohort" in result ? result.cohort : result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function ensureRollingCohorts(
  { weeks, now }: CohortRollOptions,
  deps: CohortRollDeps = {}
): Promise<CohortRollResult> {
  const db = deps.db ?? prisma;
  const createCohort = deps.createCohort ?? createCohortReal;
  const result: CohortRollResult = {
    created: [],
    skipped: [],
    warnings: [],
  };

  for (const monday of nextMondays(now, weeks)) {
    const slug = mondayCohortSlug(monday);

    try {
      // Slugs, unlike display titles, remain stable when an admin renames a cohort.
      const existing = await db.cohort.findUnique({ where: { slug } });
      if (existing) {
        result.skipped.push(existing);
        continue;
      }

      const createResult = await createCohort({
        title: cohortTitle(monday),
        slug,
        status: "ENROLLMENT",
        deliveryMode: MONDAY_COHORT_TEMPLATE.deliveryMode,
        startDate: monday,
        endDate: addUtcCalendarDays(
          monday,
          MONDAY_COHORT_TEMPLATE.cohortLengthDays - 1
        ),
        startTime: MONDAY_COHORT_TEMPLATE.startTime,
        endTime: MONDAY_COHORT_TEMPLATE.endTime,
        timezone: MONDAY_COHORT_TEMPLATE.timezone,
        instructorEmails: [...MONDAY_COHORT_TEMPLATE.instructorEmails],
        programTitles: [...MONDAY_COHORT_TEMPLATE.programTitles],
        groups: MONDAY_COHORT_TEMPLATE.groups.map((group) => ({ ...group })),
        requireGroups: true,
      });
      const cohort = createdCohort(createResult);
      result.created.push(cohort);

      try {
        const checkinSeries = await db.sessionSeries.findFirst({
          where: { kind: "CHECKIN", status: "ACTIVE" },
        });
        if (checkinSeries) {
          await db.sessionSeriesCohort.create({
            data: { seriesId: checkinSeries.id, cohortId: cohort.id },
          });
        } else {
          result.warnings.push(
            `${slug}: no active check-in session series was found; the cohort was not attached`
          );
        }
      } catch (error) {
        result.warnings.push(
          `${slug}: failed to attach the active check-in series: ${errorMessage(error)}`
        );
      }

      try {
        // syncCohortSessions()'s delete sweep filters
        // zoomOccurrenceId: { notIn: [...], not: null }, so a null-occurrence
        // authored row survives Zoom syncs — that is why onboarding uses null here.
        await db.cohortSession.create({
          data: {
            cohortId: cohort.id,
            title: MONDAY_COHORT_TEMPLATE.onboardingSession.title,
            date: monday,
            startTime: MONDAY_COHORT_TEMPLATE.onboardingSession.startTime,
            endTime: MONDAY_COHORT_TEMPLATE.onboardingSession.endTime,
            timezone: MONDAY_COHORT_TEMPLATE.timezone,
            zoomOccurrenceId: null,
          },
        });
      } catch (error) {
        result.warnings.push(
          `${slug}: failed to create the onboarding session: ${errorMessage(error)}`
        );
      }
    } catch (error) {
      result.warnings.push(`${slug}: cohort creation failed: ${errorMessage(error)}`);
    }
  }

  return result;
}
