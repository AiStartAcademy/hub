import { describe, expect, it, spyOn } from "bun:test";
import { brand } from "@/config/brand";
import {
  buildPublicCohortListing,
  type PublicCohortRow,
} from "@/lib/publicCohorts";
import {
  PUBLIC_COHORTS_ALLOWED_ORIGINS,
  PUBLIC_COHORTS_CACHE_CONTROL,
  buildPublicCohortsFeed,
  createPublicCohortsHandlers,
} from "@/lib/publicCohortsFeed";

const NOW = new Date("2026-10-03T12:00:00.000Z");

function cohortRow(overrides: Partial<PublicCohortRow> = {}): PublicCohortRow {
  return {
    id: "cohort-hybrid",
    slug: "fall-hybrid",
    title: "Fall Hybrid Cohort",
    description: "Build an AI agency.",
    cover: null,
    status: "ENROLLMENT",
    deliveryMode: "HYBRID",
    location: "San Francisco, CA",
    startDate: new Date("2026-10-19T00:00:00.000Z"),
    endDate: new Date("2026-11-06T00:00:00.000Z"),
    startTime: "9:00 AM",
    endTime: "5:00 PM",
    timezone: "America/Los_Angeles",
    tools: "Claude Code",
    certificate: true,
    leadMagnet: false,
    leadMagnetCta: null,
    instructors: [],
    sessions: [
      {
        title: "Past orientation",
        startTime: "2026-10-01T17:00:00.000Z",
        timezone: "America/Los_Angeles",
      },
      {
        title: "Session 1",
        startTime: "2026-10-20T17:00:00.000Z",
        timezone: "America/Los_Angeles",
      },
      {
        title: "Session 2",
        startTime: "2026-10-21T17:00:00.000Z",
        timezone: "America/Los_Angeles",
      },
    ],
    groups: [
      {
        id: "online",
        name: "Online Group",
        inPerson: false,
        price: 499,
        seats: 100,
        _count: { members: 47 },
        payments: [{ id: "online-hold" }],
      },
      {
        id: "in-person",
        name: "In Person",
        inPerson: true,
        price: 799,
        seats: 20,
        _count: { members: 8 },
        payments: [{ id: "hold-1" }, { id: "hold-2" }, { id: "hold-3" }],
      },
    ],
    ...overrides,
  };
}

describe("public cohorts feed", () => {
  it("SC-1 shape matches contract for hybrid paid cohort", () => {
    expect(buildPublicCohortsFeed([cohortRow()], NOW)).toEqual({
      generatedAt: "2026-10-03T12:00:00.000Z",
      cohorts: [
        {
          slug: "fall-hybrid",
          title: "Fall Hybrid Cohort",
          url: `${brand.urls.hub}/cohorts/fall-hybrid`,
          startDate: "2026-10-19",
          endDate: "2026-11-06",
          startTime: "9:00 AM",
          endTime: "5:00 PM",
          timezone: "America/Los_Angeles",
          sessionCount: 2,
          deliveryMode: "HYBRID",
          location: "San Francisco, CA",
          certificate: true,
          priceFrom: { amount: 49_900, currency: "usd" },
          tickets: [
            {
              label: "Online Group",
              mode: "online",
              price: { amount: 49_900, currency: "usd" },
              capacity: null,
              seatsLeft: null,
            },
            {
              label: "In Person",
              mode: "in_person",
              price: { amount: 79_900, currency: "usd" },
              capacity: 20,
              seatsLeft: 9,
            },
          ],
        },
      ],
    });
  });

  it("SC-2 only cohorts the public page lists are returned", () => {
    const rows = [
      cohortRow({ id: "in-progress", slug: "in-progress", status: "IN_PROGRESS" }),
      cohortRow({ id: "draft", slug: "draft", status: "DRAFT" }),
      cohortRow({ id: "complete", slug: "complete", status: "COMPLETE" }),
      cohortRow({ id: "lead", slug: "lead", leadMagnet: true }),
      cohortRow({ id: "later", slug: "later", startDate: new Date("2026-12-01T00:00:00.000Z") }),
      cohortRow({ id: "undated", slug: "undated", startDate: null }),
    ];

    expect(buildPublicCohortsFeed(rows, NOW).cohorts.map((cohort) => cohort.slug)).toEqual([
      "in-progress",
      "later",
      "undated",
    ]);
  });

  it("SC-3 seatsLeft equals public page numbers incl sold-out 0 and unlimited null", () => {
    const row = cohortRow({
      groups: [
        {
          id: "sold-out",
          name: "In Person",
          inPerson: true,
          price: 300,
          seats: 2,
          _count: { members: 3 },
          payments: [{ id: "hold" }],
        },
        {
          id: "online",
          name: "Online Group",
          inPerson: false,
          price: 200,
          seats: 1,
          _count: { members: 99 },
          payments: [{ id: "online-hold" }],
        },
      ],
    });
    const pageCohort = buildPublicCohortListing(row, false, NOW);
    const feedCohort = buildPublicCohortsFeed([row], NOW).cohorts[0];

    expect(feedCohort.tickets[0].seatsLeft).toBe(0);
    expect(feedCohort.tickets[0].seatsLeft).toBe(pageCohort.tiers[0].seatsLeft);
    expect(feedCohort.tickets[1].seatsLeft).toBeNull();
    expect(pageCohort.tiers[1].seatsLeft).toBe(0);
  });

  it("SC-4 field whitelist leaks no internal fields", () => {
    const sensitiveRow = {
      ...cohortRow(),
      zoomLink: "https://zoom.example/private",
      zoomMeetingId: "123456789",
      rocketchatGroupId: "secret-room",
      rawProgramId: "program-private",
      emails: ["student@example.com"],
      userIds: ["user-private"],
    };

    const serialized = JSON.stringify(buildPublicCohortsFeed([sensitiveRow], NOW));
    for (const forbidden of [
      "zoomLink",
      "zoomMeetingId",
      "rocketchat",
      "rawProgramId",
      "emails",
      "userIds",
      "isEnrolled",
      "member",
      "enrollment",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("@");
  });

  it("SC-5 CORS allowlist, Vary, preflight", async () => {
    const handlers = createPublicCohortsHandlers({
      loadRows: async () => [cohortRow()],
      now: () => NOW,
    });

    for (const origin of PUBLIC_COHORTS_ALLOWED_ORIGINS) {
      const response = await handlers.GET(
        new Request(`${brand.urls.hub}/api/public/cohorts`, {
          headers: { Origin: origin },
        })
      );
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Vary")).toBe("Origin");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
      expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
    }

    for (const origin of [undefined, "https://evil.example"]) {
      const headers = origin ? { Origin: origin } : undefined;
      const response = await handlers.GET(
        new Request(`${brand.urls.hub}/api/public/cohorts`, { headers })
      );
      expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
      expect(response.headers.get("Vary")).toBe("Origin");
    }

    const preflight = handlers.OPTIONS(
      new Request(`${brand.urls.hub}/api/public/cohorts`, {
        method: "OPTIONS",
        headers: { Origin: brand.urls.site },
      })
    );
    expect(preflight.status).toBe(204);
    expect(await preflight.text()).toBe("");
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      brand.urls.site
    );
    expect(preflight.headers.get("Vary")).toBe("Origin");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });

  it("SC-6 cache header exact", async () => {
    const handlers = createPublicCohortsHandlers({
      loadRows: async () => [cohortRow()],
      now: () => NOW,
    });
    const response = await handlers.GET(
      new Request(`${brand.urls.hub}/api/public/cohorts`)
    );

    expect(response.headers.get("Cache-Control")).toBe(PUBLIC_COHORTS_CACHE_CONTROL);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
    );
  });

  it("SC-7 free cohort priceFrom 0 and no tickets null", () => {
    const free = cohortRow({
      id: "free",
      slug: "free",
      groups: [
        {
          id: "free-online",
          name: "Online Group",
          inPerson: false,
          price: 0,
          seats: 50,
          _count: { members: 0 },
          payments: [],
        },
      ],
    });
    const none = cohortRow({
      id: "none",
      slug: "none",
      startDate: new Date("2026-11-01T00:00:00.000Z"),
      groups: [],
    });
    const feed = buildPublicCohortsFeed([free, none], NOW);

    expect(feed.cohorts[0].priceFrom).toEqual({ amount: 0, currency: "usd" });
    expect(feed.cohorts[1].priceFrom).toBeNull();
    expect(feed.cohorts[1].tickets).toEqual([]);
  });

  it("SC-8 internal failure returns 500 unavailable without leak", async () => {
    const error = new Error("database password student@example.com");
    const errorLog = spyOn(console, "error").mockImplementation(() => undefined);
    const handlers = createPublicCohortsHandlers({
      loadRows: async () => {
        throw error;
      },
      now: () => NOW,
    });

    const response = await handlers.GET(
      new Request(`${brand.urls.hub}/api/public/cohorts`, {
        headers: { Origin: brand.urls.siteWww },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe('{"error":"unavailable"}');
    expect(body).not.toContain(error.message);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      brand.urls.siteWww
    );
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(errorLog).toHaveBeenCalledWith("[public cohorts] unavailable", error);
    errorLog.mockRestore();
  });
});
