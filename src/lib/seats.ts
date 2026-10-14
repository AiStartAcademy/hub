// src/lib/seats.ts
// Single source of truth for "how many seats does a group have left".
// A seat is taken by a GroupMember (paid via Stripe webhook, added by an admin,
// or free-enrolled) or temporarily held by a pending, unexpired Stripe Checkout
// reservation. Paid payments are NOT counted separately — the webhook upserts
// the buyer as a GroupMember, so counting both would double-count.
// Used by the public cohorts list, the public cohort detail page, and the
// checkout capacity guard — keep all three on this helper so they can't drift.

/** Prisma `include` fragment for a Group so `seatsTaken`/`seatsLeft` can run on it. */
export function groupSeatInclude(now: Date = new Date()) {
  return {
    _count: { select: { members: true } },
    payments: {
      where: { status: "pending", expiresAt: { gt: now } },
      select: { id: true },
    },
  } as const;
}

type GroupWithSeatData = {
  seats: number;
  _count: { members: number };
  payments: { id: string }[];
};

export function seatsTaken(group: GroupWithSeatData): number {
  return group._count.members + group.payments.length;
}

export function seatsLeft(group: GroupWithSeatData): number {
  return Math.max(0, group.seats - seatsTaken(group));
}
