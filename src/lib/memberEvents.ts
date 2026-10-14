// src/lib/memberEvents.ts
//
// What a member sees under Member Calls: hand-made MemberEvent rows, plus the
// sessions of any cohort flagged with `memberEventType` (the public Q&A cohort
// mirrored as WEEKLY_QA, for instance). Both sources go through the same tier
// and type filters and come back as one MemberEventItem list, so the pages
// never learn where an item came from.

import prisma from "@/lib/prisma";
import { tierAtLeast, type MembershipSnapshot } from "@/lib/entitlements";
import type { MembershipTier } from "@/lib/membershipTiers";
import { parseProjectTimeToMinutes } from "@/lib/calendarUtils";
import { localDateKey, resolveIanaZone, sessionInterval } from "@/lib/sessionInstant";
import { resolveJoinLink } from "@/lib/sessionLink";

const MEMBER_EVENT_TIERS: MembershipTier[] = ["MENTOR_NETWORK", "ACCELERATOR"];

// Course buyers get exactly the MENTOR_NETWORK weekly Q&A slice, never Accelerator or other call types.
const COURSE_CALL_MIN_TIERS: MembershipTier[] = ["MENTOR_NETWORK"];
const COURSE_CALL_EVENT_TYPES: string[] = ["WEEKLY_QA"];

/** Every MemberEvent.type the calls page knows how to label. */
export const MEMBER_EVENT_TYPES = ["WEEKLY_QA", "COACHING", "DEAL_DESK", "BUILD_SPRINT"] as const;
export type MemberEventType = (typeof MEMBER_EVENT_TYPES)[number];

/**
 * Validate a `memberEventType` field from a request body: a known type or
 * null is accepted as-is, undefined means "not sent" (leave the column alone),
 * anything else is rejected so a typo never silently un-mirrors a cohort.
 */
export function parseMemberEventType(
  value: unknown
): { ok: true; value: MemberEventType | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value === "string" && (MEMBER_EVENT_TYPES as readonly string[]).includes(value)) {
    return { ok: true, value: value as MemberEventType };
  }
  return { ok: false };
}

/** Which tier a mirrored cohort session requires, by the MemberEvent type it mirrors as. */
const MIRRORED_MIN_TIER: Record<string, MembershipTier> = { WEEKLY_QA: "MENTOR_NETWORK" };
const MIRRORED_DEFAULT_TIER: MembershipTier = "ACCELERATOR";

export interface MemberEventItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  timezone: string;
  meetingLink: string | null;
  recordingLink: string | null;
  minTier: string;
  podId: string | null;
  status: string;
}

interface MemberEventQueryOptions {
  podIds: string[];
  limit?: number;
  /** Restrict to these MemberEvent.type values; omitted/empty = every type the tier allows. */
  types?: string[];
  /** The tick to reason about; injected by tests, defaults to the wall clock. */
  now?: Date;
}

interface CourseCallEventQueryOptions {
  podIds: string[];
  limit?: number;
  now?: Date;
}

function getAllowedMinTiers(snap: MembershipSnapshot): MembershipTier[] {
  return MEMBER_EVENT_TIERS.filter((tier) => tierAtLeast(snap, tier));
}

function getMemberEventPodScope(
  podIds: string[],
): Array<{ OR: Array<{ podId: null } | { podId: { in: string[] } }> }> {
  if (podIds.length === 0) {
    return [{ OR: [{ podId: null }] }];
  }

  return [{ OR: [{ podId: null }, { podId: { in: podIds } }] }];
}

const memberEventSelect = {
  id: true,
  type: true,
  title: true,
  description: true,
  date: true,
  startTime: true,
  endTime: true,
  timezone: true,
  meetingLink: true,
  recordingLink: true,
  minTier: true,
  podId: true,
  status: true,
} as const;

export async function getUpcomingMemberEvents(
  snap: MembershipSnapshot,
  opts: MemberEventQueryOptions,
): Promise<MemberEventItem[]> {
  if (!snap.isMember) {
    return [];
  }

  const allowedMinTiers = getAllowedMinTiers(snap);
  if (allowedMinTiers.length === 0) {
    return [];
  }

  return queryUpcomingEvents(allowedMinTiers, opts);
}

async function queryUpcomingEvents(
  allowedMinTiers: MembershipTier[],
  opts: MemberEventQueryOptions,
): Promise<MemberEventItem[]> {
  const now = opts.now ?? new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const limit = opts.limit ?? 10;

  const [rows, mirrored] = await Promise.all([
    prisma.memberEvent.findMany({
      where: {
        status: "upcoming",
        date: {
          gte: startOfToday,
        },
        minTier: {
          in: allowedMinTiers,
        },
        ...(opts.types && opts.types.length > 0
          ? {
              type: {
                in: opts.types,
              },
            }
          : {}),
        AND: getMemberEventPodScope(opts.podIds),
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: limit,
      select: memberEventSelect,
    }),
    mirroredSessionItems(allowedMinTiers, opts.types, now, "upcoming"),
  ]);

  return [...rows, ...mirrored]
    .sort((a, b) => sortInstant(a) - sortInstant(b))
    .slice(0, limit);
}

export async function getPastMemberEvents(
  snap: MembershipSnapshot,
  opts: MemberEventQueryOptions,
): Promise<MemberEventItem[]> {
  if (!snap.isMember) {
    return [];
  }

  const allowedMinTiers = getAllowedMinTiers(snap);
  if (allowedMinTiers.length === 0) {
    return [];
  }

  return queryPastEvents(allowedMinTiers, opts);
}

async function queryPastEvents(
  allowedMinTiers: MembershipTier[],
  opts: MemberEventQueryOptions,
): Promise<MemberEventItem[]> {
  const now = opts.now ?? new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const limit = opts.limit ?? 10;

  const [rows, mirrored] = await Promise.all([
    prisma.memberEvent.findMany({
      where: {
        minTier: {
          in: allowedMinTiers,
        },
        ...(opts.types && opts.types.length > 0
          ? {
              type: {
                in: opts.types,
              },
            }
          : {}),
        recordingLink: {
          not: "",
        },
        NOT: {
          recordingLink: null,
        },
        AND: [
          ...getMemberEventPodScope(opts.podIds),
          {
            OR: [
              {
                status: "completed",
              },
              {
                date: {
                  lt: startOfToday,
                },
              },
            ],
          },
        ],
      },
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
      take: limit,
      select: memberEventSelect,
    }),
    mirroredSessionItems(allowedMinTiers, opts.types, now, "past"),
  ]);

  return [...rows, ...mirrored]
    .sort((a, b) => sortInstant(b) - sortInstant(a))
    .slice(0, limit);
}

export async function getUpcomingCourseCallEvents(
  opts: CourseCallEventQueryOptions,
): Promise<MemberEventItem[]> {
  return queryUpcomingEvents(COURSE_CALL_MIN_TIERS, {
    ...opts,
    types: COURSE_CALL_EVENT_TYPES,
  });
}

export async function getPastCourseCallEvents(
  opts: CourseCallEventQueryOptions,
): Promise<MemberEventItem[]> {
  return queryPastEvents(COURSE_CALL_MIN_TIERS, {
    ...opts,
    types: COURSE_CALL_EVENT_TYPES,
  });
}

// ---------------------------------------------------------------------------
// Mirrored cohort sessions
// ---------------------------------------------------------------------------

const mirroredCohortSelect = {
  id: true,
  title: true,
  zoomLink: true,
  memberEventType: true,
  sessions: {
    orderBy: { date: "asc" as const },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      timezone: true,
      meetingLink: true,
      recordingLink: true,
      status: true,
    },
  },
} as const;

/**
 * Sessions of every mirrored cohort, already filtered the way MemberEvent rows
 * are (tier, type) and split into upcoming / past by their absolute end instant
 * rather than by `status`, because hand-made session rows never get status
 * updates. Past means finished AND recorded — an unrecorded past call has
 * nothing for a member to open.
 */
async function mirroredSessionItems(
  allowedMinTiers: MembershipTier[],
  types: string[] | undefined,
  now: Date,
  window: "upcoming" | "past",
): Promise<MemberEventItem[]> {
  const cohorts = await prisma.cohort.findMany({
    where: { memberEventType: { not: null } },
    select: mirroredCohortSelect,
  });

  const items: MemberEventItem[] = [];
  for (const cohort of cohorts) {
    const type = cohort.memberEventType;
    if (!type) continue;
    const minTier = MIRRORED_MIN_TIER[type] ?? MIRRORED_DEFAULT_TIER;
    if (!allowedMinTiers.includes(minTier)) continue;
    if (types && types.length > 0 && !types.includes(type)) continue;

    for (const session of cohort.sessions) {
      if (session.status === "cancelled") continue; // Same rule as /api/me/cohort-sessions.
      const interval = sessionInterval(session);
      if (!interval) continue; // Unparseable legacy row: cannot place it in time.
      const finished = interval.endUtc.getTime() <= now.getTime();
      if (window === "upcoming" && finished) continue;
      if (window === "past" && (!finished || !session.recordingLink?.trim())) continue;

      const zone = resolveIanaZone(session.timezone);
      items.push({
        id: `cs:${session.id}`,
        type,
        title: cohort.title,
        description: null,
        // The pages format `date` without a timeZone, so hand them UTC midnight
        // of the session's LOCAL day — an 18:00 PDT call is 01:00Z the next day.
        date: new Date(`${localDateKey(interval.startUtc, zone)}T00:00:00.000Z`),
        startTime: clockString(interval.startUtc, zone),
        endTime: clockString(interval.endUtc, zone),
        timezone: zoneAbbreviation(interval.startUtc, zone),
        meetingLink: resolveJoinLink({ meetingLink: session.meetingLink, cohort }),
        recordingLink: session.recordingLink,
        minTier,
        podId: null,
        status: session.status,
      });
    }
  }
  return items;
}

/** "6:00 PM" — the shape MemberEvent rows and the calls page already speak. */
function clockString(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/** "PDT" / "PST" — short zone name at that instant, so DST reads right. */
function zoneAbbreviation(instant: Date, zone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? zone;
}

/**
 * One scale for ordering both sources: the item's `date` (UTC midnight of the
 * local day) plus its wall-clock start in minutes. MemberEvent rows store
 * "18:00" or "6:00 PM"; mirrored items are read back from their instant.
 */
function sortInstant(item: MemberEventItem): number {
  return item.date.getTime() + wallClockMinutes(item.startTime) * 60_000;
}

function wallClockMinutes(startTime: string): number {
  const trimmed = startTime.trim();
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  try {
    return parseProjectTimeToMinutes(trimmed);
  } catch {
    return 0;
  }
}
