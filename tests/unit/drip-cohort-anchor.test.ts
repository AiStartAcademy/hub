// tests/unit/drip-cohort-anchor.test.ts
// Cohort-anchored drip scheduling: start-instant resolution across both stored
// time shapes, absolute step due times, and the skip-past-due initial cursor
// (the piece that keeps a T-3h signup from receiving a stale T-7d email).

import { describe, expect, test } from "bun:test";
import { brandStreetCity } from "@/config/brand";
import {
  cohortStartInstant,
  stepDueAt,
  initialCursor,
  cohortMergeContext,
  cohortTag,
  isCohortStepStale,
  COHORT_STEP_GRACE_MS,
  type CohortForAnchor,
} from "../../src/lib/drip/cohortAnchor";

const MIN = 60_000;

function cohort(overrides: Partial<CohortForAnchor> = {}): CohortForAnchor {
  return {
    id: "c1",
    slug: "test-cohort",
    title: "Test Cohort",
    status: "ENROLLMENT",
    deliveryMode: "HYBRID",
    location: brandStreetCity,
    zoomLink: "https://zoom.us/j/123",
    startDate: new Date("2026-08-17T00:00:00.000Z"),
    startTime: "10:00 AM",
    timezone: "PT",
    sessions: [],
    ...overrides,
  };
}

describe("cohortStartInstant", () => {
  test("wall-clock start time in PT resolves to the correct UTC instant (PDT = UTC-7)", () => {
    const start = cohortStartInstant(cohort());
    expect(start?.toISOString()).toBe("2026-08-17T17:00:00.000Z");
  });

  test("winter date uses PST (UTC-8) — DST is honored", () => {
    const start = cohortStartInstant(
      cohort({ startDate: new Date("2026-12-14T00:00:00.000Z") })
    );
    expect(start?.toISOString()).toBe("2026-12-14T18:00:00.000Z");
  });

  test("missing startTime falls back to 9am local, not UTC midnight", () => {
    const start = cohortStartInstant(cohort({ startTime: null }));
    expect(start?.toISOString()).toBe("2026-08-17T16:00:00.000Z");
  });

  test("no cohort-level date falls back to the first session", () => {
    // The session is anchored on the clock injected here, not on the wall clock,
    // so this case stays green after 2026-08-18 has come and gone.
    const now = new Date("2026-08-10T00:00:00.000Z");
    const start = cohortStartInstant(
      cohort({
        startDate: null,
        sessions: [
          {
            date: new Date("2026-08-18T00:00:00.000Z"),
            startTime: "6:00 PM",
            endTime: "9:00 PM",
            timezone: "PT",
          },
        ],
      }),
      now
    );
    expect(start?.toISOString()).toBe("2026-08-19T01:00:00.000Z");
  });

  test("nothing resolvable returns null", () => {
    expect(cohortStartInstant(cohort({ startDate: null, sessions: [] }))).toBeNull();
  });

  // SC6: a recurring cohort (startDate null) anchors on the NEXT unfinished
  // session, never on the first one ever.
  describe("recurring cohort without startDate (SC6)", () => {
    const past = {
      id: "s-past",
      date: new Date("2026-09-02T00:00:00.000Z"),
      startTime: "6:00 PM",
      endTime: "7:00 PM",
      timezone: "PT",
      meetingLink: "https://zoom.us/j/past",
    };
    const next = {
      id: "s-next",
      date: new Date("2026-09-09T00:00:00.000Z"),
      startTime: "6:00 PM",
      endTime: "7:00 PM",
      timezone: "PT",
      meetingLink: "https://zoom.us/j/next",
    };
    const later = {
      id: "s-later",
      date: new Date("2026-09-16T00:00:00.000Z"),
      startTime: "6:00 PM",
      endTime: "7:00 PM",
      timezone: "PT",
      meetingLink: "https://zoom.us/j/later",
    };
    // Between the past and next sessions.
    const now = new Date("2026-09-05T12:00:00.000Z");

    test("start = the next unfinished session, skipping the past one", () => {
      const start = cohortStartInstant(
        cohort({ startDate: null, sessions: [past, next, later] }),
        now
      );
      // Sep 9 18:00 PDT = Sep 10 01:00 UTC.
      expect(start?.toISOString()).toBe("2026-09-10T01:00:00.000Z");
    });

    test("a session still running at `now` is the anchor (end instant decides)", () => {
      const mid = new Date("2026-09-10T01:30:00.000Z"); // 30 min into `next`
      const start = cohortStartInstant(
        cohort({ startDate: null, sessions: [past, next, later] }),
        mid
      );
      expect(start?.toISOString()).toBe("2026-09-10T01:00:00.000Z");
    });

    test("null when every session has finished — no last-session fallback", () => {
      const afterAll = new Date("2026-10-01T00:00:00.000Z");
      expect(
        cohortStartInstant(cohort({ startDate: null, sessions: [past, next, later] }), afterAll)
      ).toBeNull();
    });

    test("cohortMergeContext.zoomLink is the next session's link", () => {
      const ctx = cohortMergeContext(
        cohort({ startDate: null, sessions: [past, next, later] }),
        new Date("2026-09-10T01:00:00.000Z"),
        "https://hub.test",
        now
      );
      expect(ctx.zoomLink).toBe("https://zoom.us/j/next");
    });

    test("cohortMergeContext.zoomLink falls back to the cohort link when the next session has none", () => {
      const ctx = cohortMergeContext(
        cohort({
          startDate: null,
          sessions: [past, { ...next, meetingLink: null }, later],
        }),
        new Date("2026-09-10T01:00:00.000Z"),
        "https://hub.test",
        now
      );
      expect(ctx.zoomLink).toBe("https://zoom.us/j/123");
    });

    test("cohortMergeContext.zoomLink is the cohort link when nothing is upcoming", () => {
      const ctx = cohortMergeContext(
        cohort({ startDate: null, sessions: [past] }),
        null,
        "https://hub.test",
        now
      );
      expect(ctx.zoomLink).toBe("https://zoom.us/j/123");
    });
  });
});

// SC7: the stale guard the engine runs before sending a cohort-anchored step.
describe("isCohortStepStale", () => {
  const cohortStart = new Date("2026-09-10T01:00:00.000Z");
  const due = new Date(cohortStart.getTime() - 120 * MIN); // T-2h

  test("unresolvable due (cohort start vanished) is stale", () => {
    expect(isCohortStepStale({ due: null, cohortStart: null, now: due })).toBe(true);
  });

  test("due more than the grace window ago is stale", () => {
    const now = new Date(due.getTime() + COHORT_STEP_GRACE_MS + MIN);
    expect(isCohortStepStale({ due, cohortStart, now })).toBe(true);
  });

  test("cohort already started is stale", () => {
    const now = new Date(cohortStart.getTime() + MIN);
    expect(isCohortStepStale({ due: cohortStart, cohortStart, now })).toBe(true);
  });

  test("due within grace, before class, scheduled for this moment is NOT stale", () => {
    const now = new Date(due.getTime() + 10 * MIN);
    expect(isCohortStepStale({ due, cohortStart, now, scheduledFor: due })).toBe(false);
  });

  test("a due that drifted a week past the moment it was scheduled for is stale (anchor moved)", () => {
    // Cursor was written for the Sep 2 session; the anchor rolled over to Sep 9.
    const scheduledFor = new Date(due.getTime() - 7 * 24 * 60 * MIN);
    const now = new Date(due.getTime() + 10 * MIN);
    expect(isCohortStepStale({ due, cohortStart, now, scheduledFor })).toBe(true);
  });

  test("a due within grace of its scheduled moment is not stale", () => {
    const scheduledFor = new Date(due.getTime() - 5 * MIN);
    const now = new Date(due.getTime() + 10 * MIN);
    expect(isCohortStepStale({ due, cohortStart, now, scheduledFor })).toBe(false);
  });
});

describe("stepDueAt", () => {
  const start = new Date("2026-08-17T17:00:00.000Z");
  const enrolledAt = new Date("2026-08-01T00:00:00.000Z");

  test("COHORT_START is absolute: start + offsetMinutes", () => {
    const due = stepDueAt(
      { anchor: "COHORT_START", offsetMinutes: -1440, delayHours: 999 },
      start,
      enrolledAt
    );
    expect(due?.toISOString()).toBe("2026-08-16T17:00:00.000Z");
  });

  test("COHORT_START without a start instant is null", () => {
    expect(
      stepDueAt({ anchor: "COHORT_START", offsetMinutes: -120, delayHours: 0 }, null, enrolledAt)
    ).toBeNull();
  });

  test("ENROLLMENT uses delayHours from enrollment", () => {
    const due = stepDueAt(
      { anchor: "ENROLLMENT", offsetMinutes: -999, delayHours: 24 },
      start,
      enrolledAt
    );
    expect(due?.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("initialCursor (skip-past-due)", () => {
  const steps = [
    { order: 1, anchor: "ENROLLMENT", offsetMinutes: 0, delayHours: 0 }, // welcome
    { order: 2, anchor: "COHORT_START", offsetMinutes: -10080, delayHours: 0 }, // T-7d
    { order: 3, anchor: "COHORT_START", offsetMinutes: -1440, delayHours: 0 }, // T-1d
    { order: 4, anchor: "COHORT_START", offsetMinutes: -120, delayHours: 0 }, // T-2h
  ];
  const start = new Date("2026-08-17T17:00:00.000Z");

  test("early signup starts at the welcome step", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const cursor = initialCursor(steps, start, now);
    expect(cursor).toEqual({ lastStepOrder: 0, nextRunAt: now });
  });

  test("T-3h signup gets welcome now, with T-7d/T-1d never pre-blocking", () => {
    const now = new Date(start.getTime() - 180 * MIN);
    const cursor = initialCursor(steps, start, now);
    // Welcome is order 1 and ENROLLMENT-anchored: due immediately.
    expect(cursor).toEqual({ lastStepOrder: 0, nextRunAt: now });
  });

  test("T-3h signup with skipWelcome jumps past stale T-7d/T-1d to T-2h", () => {
    const now = new Date(start.getTime() - 180 * MIN);
    const cursor = initialCursor(steps, start, now, { skipWelcome: true });
    expect(cursor?.lastStepOrder).toBe(3); // 1 (welcome skipped) + 2,3 past due
    expect(cursor?.nextRunAt.toISOString()).toBe(
      new Date(start.getTime() - 120 * MIN).toISOString()
    );
  });

  test("signup after every step is past due yields null (nothing to send)", () => {
    const now = new Date(start.getTime() - 30 * MIN);
    const cursor = initialCursor(steps, start, now, { skipWelcome: true });
    expect(cursor).toBeNull();
  });

  test("unresolvable cohort start with only COHORT_START steps yields null", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const cursor = initialCursor(steps.slice(1), null, now);
    expect(cursor).toBeNull();
  });
});

describe("cohortMergeContext", () => {
  test("formats date/time in the cohort's zone and exposes venue for HYBRID", () => {
    const c = cohort();
    const ctx = cohortMergeContext(c, new Date("2026-08-17T17:00:00.000Z"), "https://hub.test");
    expect(ctx.cohortTitle).toBe("Test Cohort");
    expect(ctx.cohortStartDate).toBe("Monday, August 17, 2026");
    expect(ctx.cohortStartTime).toBe("10:00 AM PDT");
    expect(ctx.zoomLink).toBe("https://zoom.us/j/123");
    expect(ctx.venueAddress).toBe(brandStreetCity);
    expect(ctx.cohortUrl).toBe("https://hub.test/cohorts/test-cohort");
  });

  test("ONLINE cohorts never leak a venue address", () => {
    const ctx = cohortMergeContext(
      cohort({ deliveryMode: "ONLINE" }),
      new Date("2026-08-17T17:00:00.000Z"),
      "https://hub.test"
    );
    expect(ctx.venueAddress).toBeUndefined();
  });

  test("null start instant leaves date/time undefined (merge fields fall back)", () => {
    const ctx = cohortMergeContext(cohort(), null, "https://hub.test");
    expect(ctx.cohortStartDate).toBeUndefined();
    expect(ctx.cohortStartTime).toBeUndefined();
  });
});

describe("cohortTag", () => {
  test("prefers slug, falls back to id", () => {
    expect(cohortTag({ slug: "abc", id: "x" })).toBe("cohort:abc");
    expect(cohortTag({ slug: null, id: "x" })).toBe("cohort:x");
  });
});
