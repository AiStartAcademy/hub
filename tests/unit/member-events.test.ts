// tests/unit/member-events.test.ts
// SC8: cohorts flagged with memberEventType mirror their CohortSession rows
// into Member Calls next to hand-made MemberEvent rows — same tier and type
// filters, local-day date, clock-string times, effective join link.

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";
import type { MembershipSnapshot } from "@/lib/entitlements";

type Row = Record<string, unknown>;

let memberEventRows: Row[] = [];
let cohortRows: Row[] = [];
const memberEventCalls: Row[] = [];
const cohortCalls: Row[] = [];

mock.module("@/lib/prisma", () => ({
  default: {
    memberEvent: {
      findMany: async (args: Row) => {
        memberEventCalls.push(args);
        return memberEventRows;
      },
    },
    cohort: {
      findMany: async (args: Row) => {
        cohortCalls.push(args);
        return cohortRows;
      },
    },
  },
}));

const {
  getUpcomingMemberEvents,
  getPastMemberEvents,
  getUpcomingCourseCallEvents,
  getPastCourseCallEvents,
} = await import("@/lib/memberEvents");

function snap(tier: "MENTOR_NETWORK" | "ACCELERATOR"): MembershipSnapshot {
  return {
    tier,
    status: "active",
    isMember: true,
    inGrace: false,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    membershipId: "m1",
  };
}

// Sep 9 2026, 6:00–7:00 PM PDT stored as ISO instants (the Zoom-sync shape).
const isoSession = {
  id: "s-iso",
  date: new Date("2026-09-10T01:00:00.000Z"),
  startTime: "2026-09-10T01:00:00.000Z",
  endTime: "2026-09-10T02:00:00.000Z",
  timezone: "America/Los_Angeles",
  meetingLink: "https://zoom.us/j/session",
  recordingLink: null,
  status: "upcoming",
};

// Sep 16 2026, 6:00–7:00 PM PT stored as wall clock (hand-made shape).
const wallSession = {
  id: "s-wall",
  date: new Date("2026-09-16T00:00:00.000Z"),
  startTime: "6:00 PM",
  endTime: "7:00 PM",
  timezone: "PT",
  meetingLink: null,
  recordingLink: null,
  status: "upcoming",
};

const qaCohort = {
  id: "c-qa",
  title: `${brand.name} Q&A`,
  zoomLink: "https://zoom.us/j/cohort",
  memberEventType: "WEEKLY_QA",
  sessions: [isoSession, wallSession],
};

const now = new Date("2026-09-05T12:00:00.000Z");

describe("memberEvents mirror (SC8)", () => {
  beforeEach(() => {
    memberEventRows = [];
    cohortRows = [];
    memberEventCalls.length = 0;
    cohortCalls.length = 0;
  });

  it("only queries cohorts that are mirrored", async () => {
    cohortRows = [qaCohort];
    await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now });
    expect(cohortCalls).toHaveLength(1);
    expect((cohortCalls[0].where as Row).memberEventType).toEqual({ not: null });
  });

  it("a WEEKLY_QA-mirrored session shows in upcoming for MENTOR_NETWORK with local-day date, clock times and the effective link", async () => {
    cohortRows = [qaCohort];
    const items = await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now });
    expect(items.map((i) => i.id)).toEqual(["cs:s-iso", "cs:s-wall"]);

    const iso = items[0];
    expect(iso.type).toBe("WEEKLY_QA");
    expect(iso.title).toBe(`${brand.name} Q&A`);
    // 2026-09-10T01:00Z is Sep 9 in Los Angeles: date is UTC midnight of that local day.
    expect(iso.date.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(iso.startTime).toBe("6:00 PM");
    expect(iso.endTime).toBe("7:00 PM");
    expect(iso.timezone).toBe("PDT");
    expect(iso.meetingLink).toBe("https://zoom.us/j/session");
    expect(iso.recordingLink).toBeNull();
    expect(iso.minTier).toBe("MENTOR_NETWORK");
    expect(iso.podId).toBeNull();
    expect(iso.status).toBe("upcoming");
    expect(iso.description).toBeNull();

    const wall = items[1];
    expect(wall.date.toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(wall.startTime).toBe("6:00 PM");
    expect(wall.endTime).toBe("7:00 PM");
    expect(wall.timezone).toBe("PDT");
    // No session link: falls back to the cohort's.
    expect(wall.meetingLink).toBe("https://zoom.us/j/cohort");
  });

  it("the course-call variant (MENTOR_NETWORK + WEEKLY_QA slice) includes the mirrored session", async () => {
    cohortRows = [qaCohort];
    const items = await getUpcomingCourseCallEvents({ podIds: [], now });
    expect(items.map((i) => i.id)).toEqual(["cs:s-iso", "cs:s-wall"]);
    expect(items[0].startTime).toBe("6:00 PM");
    expect(items[0].meetingLink).toBe("https://zoom.us/j/session");
  });

  it("past mirrored sessions appear only with a recordingLink", async () => {
    const later = new Date("2026-10-01T00:00:00.000Z");
    cohortRows = [
      {
        ...qaCohort,
        sessions: [
          { ...isoSession, recordingLink: "https://hub.test/courses/raw/lesson-1" },
          { ...wallSession, recordingLink: "" },
        ],
      },
    ];
    const past = await getPastMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now: later });
    expect(past.map((i) => i.id)).toEqual(["cs:s-iso"]);
    expect(past[0].recordingLink).toBe("https://hub.test/courses/raw/lesson-1");

    const pastCourse = await getPastCourseCallEvents({ podIds: [], now: later });
    expect(pastCourse.map((i) => i.id)).toEqual(["cs:s-iso"]);

    // And a finished session never shows in upcoming, recording or not.
    const upcoming = await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now: later });
    expect(upcoming).toEqual([]);
  });

  it("a cancelled mirrored session is never listed, even when its time is upcoming", async () => {
    cohortRows = [{ ...qaCohort, sessions: [{ ...isoSession, status: "cancelled" }] }];
    const items = await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now });
    expect(items.some((i) => i.id === "cs:s-iso")).toBe(false);
  });

  it("cohorts with memberEventType null never appear", async () => {
    cohortRows = [{ ...qaCohort, memberEventType: null }];
    const items = await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now });
    expect(items).toEqual([]);
  });

  it("a COACHING-mirrored session is hidden from MENTOR_NETWORK and from course buyers, visible to ACCELERATOR", async () => {
    cohortRows = [{ ...qaCohort, id: "c-coach", memberEventType: "COACHING" }];
    expect(await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now })).toEqual([]);
    expect(await getUpcomingCourseCallEvents({ podIds: [], now })).toEqual([]);
    const items = await getUpcomingMemberEvents(snap("ACCELERATOR"), { podIds: [], now });
    expect(items.map((i) => i.id)).toEqual(["cs:s-iso", "cs:s-wall"]);
    expect(items[0].type).toBe("COACHING");
    expect(items[0].minTier).toBe("ACCELERATOR");
  });

  it("the types filter applies to mirrored items too", async () => {
    cohortRows = [qaCohort];
    const items = await getUpcomingMemberEvents(snap("ACCELERATOR"), {
      podIds: [],
      now,
      types: ["COACHING"],
    });
    expect(items).toEqual([]);
  });

  it("union keeps date order across both sources and respects limit", async () => {
    memberEventRows = [
      {
        id: "me-1",
        type: "WEEKLY_QA",
        title: "Hand-made Q&A",
        description: null,
        date: new Date("2026-09-12T00:00:00.000Z"),
        startTime: "18:00",
        endTime: "19:00",
        timezone: "PT",
        meetingLink: "https://zoom.us/j/me1",
        recordingLink: null,
        minTier: "MENTOR_NETWORK",
        podId: null,
        status: "upcoming",
      },
    ];
    cohortRows = [qaCohort];
    const all = await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now });
    expect(all.map((i) => i.id)).toEqual(["cs:s-iso", "me-1", "cs:s-wall"]);

    const limited = await getUpcomingMemberEvents(snap("MENTOR_NETWORK"), {
      podIds: [],
      now,
      limit: 2,
    });
    expect(limited.map((i) => i.id)).toEqual(["cs:s-iso", "me-1"]);
  });

  it("past union is newest-first and respects limit", async () => {
    const later = new Date("2026-10-01T00:00:00.000Z");
    memberEventRows = [
      {
        id: "me-old",
        type: "WEEKLY_QA",
        title: "Old Q&A",
        description: null,
        date: new Date("2026-09-12T00:00:00.000Z"),
        startTime: "18:00",
        endTime: "19:00",
        timezone: "PT",
        meetingLink: null,
        recordingLink: "https://rec/me-old",
        minTier: "MENTOR_NETWORK",
        podId: null,
        status: "completed",
      },
    ];
    cohortRows = [
      {
        ...qaCohort,
        sessions: [
          { ...isoSession, recordingLink: "https://rec/iso" },
          { ...wallSession, recordingLink: "https://rec/wall" },
        ],
      },
    ];
    const past = await getPastMemberEvents(snap("MENTOR_NETWORK"), { podIds: [], now: later });
    expect(past.map((i) => i.id)).toEqual(["cs:s-wall", "me-old", "cs:s-iso"]);
    const limited = await getPastMemberEvents(snap("MENTOR_NETWORK"), {
      podIds: [],
      now: later,
      limit: 1,
    });
    expect(limited.map((i) => i.id)).toEqual(["cs:s-wall"]);
  });

  it("non-members get nothing, mirrored or not", async () => {
    cohortRows = [qaCohort];
    const none = await getUpcomingMemberEvents({ ...snap("MENTOR_NETWORK"), isMember: false, tier: null }, { podIds: [], now });
    expect(none).toEqual([]);
    expect(cohortCalls).toHaveLength(0);
  });
});
