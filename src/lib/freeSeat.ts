// src/lib/freeSeat.ts
//
// Granting a seat in a $0 group, for anyone, without Stripe.
//
// The hub had two half-paths into a free cohort: `register-free`, which captured
// a Contact lead and nothing else (so nobody could actually attend), and
// `/enroll`, which created the rows but required an existing signed-in student.
// This module is the one path both now go through, keyed on the group's price
// rather than on the cohort-level `leadMagnet` flag — the flag describes one
// instance, the price describes the class.
//
// Prisma work lives here rather than in the route so the decision logic above it
// (waiver, next session, capacity) is unit-testable without a database.

import prisma from "@/lib/prisma";
import { autoLinkContactForUser } from "@/lib/leads/linking";
import { groupSeatInclude, seatsTaken } from "@/lib/seats";
import { resolveJoinLink } from "@/lib/sessionLink";
import { sessionInterval } from "@/lib/sessionInstant";
import { fmtSessionWhen } from "@/lib/sessionTime";
import { logger } from "@/lib/logger";

export function isFreeGroup(group: { price: number }): boolean {
  return group.price <= 0;
}

/**
 * Whether this registration needs the venue's visitor waiver.
 *
 * A chosen group is authoritative: the Online Group of a HYBRID cohort is never
 * in the room, and an In Person group always is. Only with no group to go on
 * (a lead-magnet cohort) do we fall back to the cohort's delivery mode.
 */
export function waiverRequired({
  group,
  cohort,
}: {
  group?: { inPerson: boolean } | null;
  cohort: { deliveryMode: string };
}): boolean {
  if (group) return group.inPerson;
  return cohort.deliveryMode === "INPERSON" || cohort.deliveryMode === "HYBRID";
}

export type SessionForJoin = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  timezone: string | null;
  meetingLink: string | null;
};

export type CohortForJoin = {
  zoomLink: string | null;
  sessions: SessionForJoin[];
};

/**
 * The session a registrant is about to attend: the earliest one that has not
 * finished yet, so a mid-session signup still gets tonight's link rather than
 * next week's. Null when nothing is upcoming — a past session's link is worse
 * than no link, because it reads as an invitation.
 *
 * Rows whose stored times can't be parsed are skipped, matching sessionInterval's
 * "cannot reason about this session's time" contract.
 */
export function nextUpcomingSession<T extends SessionForJoin>(
  sessions: T[],
  now: Date
): T | null {
  let best: { session: T; startMs: number } | null = null;
  for (const session of sessions) {
    const interval = sessionInterval(session);
    if (!interval) continue;
    if (interval.endUtc.getTime() <= now.getTime()) continue;
    const startMs = interval.startUtc.getTime();
    if (!best || startMs < best.startMs) best = { session, startMs };
  }
  return best?.session ?? null;
}

export type NextSessionJoin<T extends SessionForJoin = SessionForJoin> = {
  session: T;
  link: string | null;
  whenLine: string | null;
};

/**
 * Everything a confirmation email needs to say "you're in, here is when and
 * where": the next upcoming session, the link a student would click for it, and
 * a human when-line rendered in the session's own zone.
 */
export function nextSessionJoinLink<T extends SessionForJoin>(
  cohort: { zoomLink: string | null; sessions: T[] },
  now: Date
): NextSessionJoin<T> | null {
  const session = nextUpcomingSession(cohort.sessions, now);
  if (!session) return null;

  const interval = sessionInterval(session);
  return {
    session,
    link: resolveJoinLink({ meetingLink: session.meetingLink, cohort }),
    whenLine: interval
      ? fmtSessionWhen(interval.startUtc.toISOString(), interval.ianaTz)
      : null,
  };
}

/** No seat to give: the group is at capacity, or it no longer exists. */
export class GroupFullError extends Error {
  readonly reason: "full" | "missing";

  constructor(reason: "full" | "missing", message: string) {
    super(message);
    this.name = "GroupFullError";
    this.reason = reason;
  }
}

export type GrantFreeSeatInput = {
  cohortId: string;
  /** Omit for a lead-magnet cohort that has no tiers to join. */
  groupId?: string | null;
  email: string;
  name: string | null;
  /** JSON string, as stored on User/Enrollment — not a parsed object. */
  attribution: string | null;
  segment: string | null;
};

export type GrantFreeSeatResult = {
  userId: string;
  /** True when the account has no password yet, so the email must carry a setup link. */
  isNewAccount: boolean;
};

/**
 * Put someone in a free cohort: account, group seat, enrollment.
 *
 * Both rows matter — ManageView gates the Join button on GroupMember while the
 * view selector reads either, so a half-grant shows a cohort nobody can join.
 * Idempotent by construction: every write is an upsert keyed on a unique index,
 * so re-registering re-sends the email without duplicating anything.
 *
 * Throws GroupFullError when a group was named and has no seat left; every other
 * failure propagates, because a registration that silently didn't happen is worse
 * than a 500.
 */
export async function grantFreeSeat(
  input: GrantFreeSeatInput
): Promise<GrantFreeSeatResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || null;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true },
  });

  // Upsert rather than create even though we just looked: two concurrent
  // registrations for the same new email would otherwise race on the unique
  // index. The update is deliberately a no-op on everything but the key so a
  // returning student's profile and first-touch attribution survive untouched.
  const user = await prisma.user.upsert({
    where: { email },
    update: { email },
    create: {
      email,
      name,
      role: "STUDENT",
      attribution: input.attribution,
    },
    select: { id: true, password: true },
  });

  if (!existing) {
    // Best-effort: an unlinked Contact for this email should become theirs, but
    // a linking failure must never cost them the seat they just registered for.
    try {
      await autoLinkContactForUser(user.id);
    } catch (error) {
      logger.error(
        { err: error, userId: user.id },
        "[freeSeat] contact auto-link failed (seat still granted)"
      );
    }
  }

  const groupId = input.groupId ?? null;
  if (groupId) {
    const group = await prisma.group.findFirst({
      where: { id: groupId, cohortId: input.cohortId },
      select: { id: true, seats: true, ...groupSeatInclude() },
    });
    if (!group) {
      throw new GroupFullError(
        "missing",
        `Group ${groupId} is not part of cohort ${input.cohortId}`
      );
    }

    // Someone re-registering is already occupying one of the taken seats, so the
    // capacity gate must not lock them out of their own group.
    const alreadyMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
      select: { id: true },
    });
    if (!alreadyMember && seatsTaken(group) >= group.seats) {
      throw new GroupFullError("full", `Group ${groupId} is full`);
    }
  }

  await prisma.$transaction([
    ...(groupId
      ? [
          prisma.groupMember.upsert({
            where: { groupId_userId: { groupId, userId: user.id } },
            create: { groupId, userId: user.id },
            update: {},
          }),
        ]
      : []),
    prisma.enrollment.upsert({
      where: { userId_cohortId: { userId: user.id, cohortId: input.cohortId } },
      create: {
        userId: user.id,
        cohortId: input.cohortId,
        source: "free",
        attribution: input.attribution,
        segment: input.segment,
      },
      // Re-registering after dropping out puts them back in the cohort; nothing
      // else is touched, so the original attribution stays first-touch.
      update: { status: "active" },
    }),
  ]);

  return { userId: user.id, isNewAccount: !user.password };
}
