import { beforeEach, describe, expect, it, mock } from "bun:test";
import { brand } from "@/config/brand";

const cohortFindManyCalls: Array<Record<string, unknown>> = [];
let cohortFindManyRows: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", () => ({
  default: {
    cohort: {
      findMany: async (args: Record<string, unknown>) => {
        cohortFindManyCalls.push(args);
        return cohortFindManyRows;
      },
    },
  },
}));

const {
  getUpcomingCohorts,
  priceLabel,
  renderNextCohortLine,
  renderUpcomingCohortsHtml,
} = await import("@/lib/drip/cohorts");

describe("drip cohorts helpers", () => {
  beforeEach(() => {
    cohortFindManyCalls.length = 0;
    cohortFindManyRows = [];
  });

  it("falls back to the hub cohorts page when nothing is scheduled", () => {
    const html = renderUpcomingCohortsHtml([], brand.urls.hub);

    expect(html).toContain(`${brand.urls.hub}/cohorts`);
    expect(html).toContain("/cohorts");
    expect(html).not.toContain("luma");
  });

  it("tags each cohort's link with UTM params, keyed off the campaign and step", () => {
    const html = renderUpcomingCohortsHtml(
      [
        {
          title: "10-Day Intensive",
          url: `${brand.urls.hub}/cohorts/ten-day-intensive-aug`,
          dateLabel: "Aug 17 – Aug 28, 2026",
          timeLabel: "10:00am–5:00pm PT",
          priceLabel: "$500",
        },
      ],
      brand.urls.hub,
      { campaign: "agency-launch-nurture", stepOrder: 4 }
    );

    const href = html.match(/href="([^"]+)"/)![1];
    const params = new URL(href).searchParams;
    expect(href).toStartWith(`${brand.urls.hub}/cohorts/ten-day-intensive-aug?`);
    expect(params.get("utm_source")).toBe("email");
    expect(params.get("utm_medium")).toBe("drip");
    expect(params.get("utm_campaign")).toBe("agency-launch-nurture");
    expect(params.get("utm_content")).toBe("step4-cohort-ten-day-intensive-aug");
  });

  it("tags the empty-state fallback link too", () => {
    const html = renderUpcomingCohortsHtml([], brand.urls.hub, {
      campaign: "dormant-lead-revival-30d-inactive",
      stepOrder: 2,
    });

    const href = html.match(/href="([^"]+)"/)![1];
    const params = new URL(href).searchParams;
    expect(params.get("utm_campaign")).toBe("dormant-lead-revival-30d-inactive");
    expect(params.get("utm_content")).toBe("step2-cohorts");
  });

  it("renders plain untagged links when no utm option is given", () => {
    const html = renderUpcomingCohortsHtml(
      [
        {
          title: "10-Day Intensive",
          url: `${brand.urls.hub}/cohorts/ten-day-intensive-aug`,
          dateLabel: "Aug 17 – Aug 28, 2026",
          timeLabel: null,
          priceLabel: null,
        },
      ],
      brand.urls.hub
    );

    expect(html).toContain(`href="${brand.urls.hub}/cohorts/ten-day-intensive-aug"`);
    expect(html).not.toContain("utm_source");
  });

  it("renders no price for free groups", () => {
    expect(
      priceLabel([
        { id: "g1", name: "Zoom", inPerson: false, price: 0, seats: 20 },
        { id: "g2", name: "SF", inPerson: true, price: 0, seats: 12 },
      ])
    ).toBeNull();
  });

  it("renders a single cohort price without cents for integral amounts", () => {
    expect(
      priceLabel([{ id: "g1", name: "Zoom", inPerson: false, price: 500, seats: 20 }])
    ).toBe("$500");
  });

  it("renders online plus in-person pricing in that order", () => {
    expect(
      priceLabel([
        { id: "g1", name: "SF", inPerson: true, price: 500, seats: 12 },
        { id: "g2", name: "Online", inPerson: false, price: 150, seats: 40 },
      ])
    ).toBe("Online $150 · SF $500");
  });

  it("asks Prisma for upcoming cohorts ordered by start date ascending", async () => {
    cohortFindManyRows = [
      {
        id: "cm000000001",
        slug: null,
        title: "September cohort",
        startDate: new Date("2026-09-15T00:00:00.000Z"),
        endDate: new Date("2026-09-20T00:00:00.000Z"),
        startTime: "10:00am",
        endTime: "5:00pm",
        timezone: "PT",
        groups: [{ id: "g1", name: "Zoom", inPerson: false, price: 500, seats: 20 }],
      },
    ];

    const cohorts = await getUpcomingCohorts(brand.urls.hub, 2);

    expect(cohorts).toHaveLength(1);
    expect(cohortFindManyCalls).toHaveLength(1);
    expect(cohortFindManyCalls[0]).toMatchObject({
      orderBy: { startDate: "asc" },
      take: 2,
      where: {
        status: "ENROLLMENT",
        leadMagnet: false,
      },
    });
  });

  it("links each cohort to its own page, not the bare list — slug when present, id otherwise", async () => {
    cohortFindManyRows = [
      {
        id: "cm000000001",
        slug: "ten-day-intensive-aug",
        title: "10-Day Intensive",
        startDate: new Date("2026-08-17T00:00:00.000Z"),
        endDate: new Date("2026-08-28T00:00:00.000Z"),
        startTime: "10:00am",
        endTime: "5:00pm",
        timezone: "PT",
        groups: [],
      },
      {
        id: "cm000000002",
        slug: null, // older row, predates the slug column
        title: "3-Week Evening Edition",
        startDate: new Date("2026-09-07T00:00:00.000Z"),
        endDate: new Date("2026-09-25T00:00:00.000Z"),
        startTime: "6:00pm",
        endTime: "9:00pm",
        timezone: "PT",
        groups: [],
      },
    ];

    const cohorts = await getUpcomingCohorts(brand.urls.hub, 2);

    expect(cohorts[0].url).toBe(`${brand.urls.hub}/cohorts/ten-day-intensive-aug`);
    expect(cohorts[1].url).toBe(`${brand.urls.hub}/cohorts/cm000000002`);
    // Neither is the generic list page — that was the bug being fixed.
    expect(cohorts[0].url).not.toBe(`${brand.urls.hub}/cohorts`);
    expect(cohorts[1].url).not.toBe(`${brand.urls.hub}/cohorts`);
  });

  it("uses the first cohort for the next-cohort line", () => {
    const line = renderNextCohortLine([
      {
        title: "Soonest",
        url: `${brand.urls.hub}/cohorts`,
        dateLabel: "Sep 10, 2026",
        timeLabel: "10:00am–5:00pm PT",
        priceLabel: "$500",
      },
      {
        title: "Later",
        url: `${brand.urls.hub}/cohorts`,
        dateLabel: "Oct 10, 2026",
        timeLabel: "10:00am–5:00pm PT",
        priceLabel: "$700",
      },
    ]);

    expect(line).toContain("Soonest");
    expect(line).not.toContain("Later");
  });
});
