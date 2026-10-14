import { beforeEach, describe, expect, it, mock } from "bun:test";

type Row = Record<string, unknown>;

const calls = {
  campaignFindUnique: [] as Row[],
  campaignCreate: [] as Row[],
};

let occupiedSlugs = new Set<string>();
let campaign: Row;

function makeCampaign(overrides: Row = {}): Row {
  return {
    id: "campaign-1",
    slug: "q3-launch",
    name: "Q3 Launch",
    description: "Launch sequence",
    status: "ACTIVE",
    trigger: "BROADCAST",
    segment: '{"sources":["manual"]}',
    autoEnroll: true,
    exitOnStatuses: '["WON"]',
    priority: 7,
    timezone: "America/Los_Angeles",
    sendWindowStartHour: 8,
    sendWindowEndHour: 16,
    skipWeekends: true,
    testEmail: "test@example.com",
    sentAt: new Date("2026-09-01T18:00:00.000Z"),
    audienceSnapshot: '{"contactIds":["contact-1"]}',
    steps: [
      {
        id: "step-1",
        campaignId: "campaign-1",
        order: 1,
        delayHours: 0,
        anchor: null,
        offsetMinutes: null,
        channel: "EMAIL",
        subject: "First",
        body: "Hello",
        ctaLabel: "Start",
        ctaUrl: "https://example.com/start",
        callAssistantId: null,
        callFirstMessage: null,
      },
      {
        id: "step-2",
        campaignId: "campaign-1",
        order: 2,
        delayHours: 24,
        anchor: "COHORT_START",
        offsetMinutes: -30,
        channel: "VOICE",
        subject: null,
        body: "Call body",
        ctaLabel: null,
        ctaUrl: null,
        callAssistantId: "assistant-1",
        callFirstMessage: "Welcome",
      },
    ],
    ...overrides,
  };
}

const prismaMock = {
  dripCampaign: {
    findUnique: async (args: Row) => {
      calls.campaignFindUnique.push(args);
      const where = (args.where ?? {}) as Row;
      if (where.id === "campaign-1") return campaign;
      if (typeof where.slug === "string" && occupiedSlugs.has(where.slug)) {
        return { id: `occupied-${where.slug}` };
      }
      return null;
    },
    create: async (args: Row) => {
      calls.campaignCreate.push(args);
      const data = (args.data ?? {}) as Row;
      return { id: "campaign-copy-1", slug: data.slug, name: data.name };
    },
  },
};

mock.module("@/lib/prisma", () => ({ default: prismaMock }));

const { duplicateCampaign } = await import("@/lib/drip/admin");

function createdData(): Row {
  return (calls.campaignCreate[0]?.data ?? {}) as Row;
}

function createdSteps(): Row[] {
  const steps = createdData().steps as Row;
  return (steps.create ?? []) as Row[];
}

function resetFixtures(): void {
  calls.campaignFindUnique.length = 0;
  calls.campaignCreate.length = 0;
  occupiedSlugs = new Set();
  campaign = makeCampaign();
}

describe("duplicateCampaign", () => {
  beforeEach(resetFixtures);

  it("SC-17: copies steps in order into a DRAFT copy", async () => {
    const result = await duplicateCampaign("campaign-1");

    expect(result).toEqual({
      id: "campaign-copy-1",
      slug: "copy-of-q3-launch",
      name: "Copy of Q3 Launch",
    });
    expect(calls.campaignFindUnique[0]).toMatchObject({
      where: { id: "campaign-1" },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    expect(createdData().status).toBe("DRAFT");
    expect(createdSteps()).toEqual([
      {
        order: 1,
        delayHours: 0,
        anchor: null,
        offsetMinutes: null,
        channel: "EMAIL",
        subject: "First",
        body: "Hello",
        ctaLabel: "Start",
        ctaUrl: "https://example.com/start",
        callAssistantId: null,
        callFirstMessage: null,
      },
      {
        order: 2,
        delayHours: 24,
        anchor: "COHORT_START",
        offsetMinutes: -30,
        channel: "VOICE",
        subject: null,
        body: "Call body",
        ctaLabel: null,
        ctaUrl: null,
        callAssistantId: "assistant-1",
        callFirstMessage: "Welcome",
      },
    ]);
  });

  it('SC-18: gives the copy a unique slug and a "Copy of …" name', async () => {
    occupiedSlugs = new Set(["copy-of-q3-launch", "copy-of-q3-launch-2"]);

    await duplicateCampaign("campaign-1");

    expect(createdData().name).toBe("Copy of Q3 Launch");
    expect(createdData().slug).toBe("copy-of-q3-launch-3");
    expect(calls.campaignFindUnique.slice(1).map((call) => call.where)).toEqual([
      { slug: "copy-of-q3-launch" },
      { slug: "copy-of-q3-launch-2" },
      { slug: "copy-of-q3-launch-3" },
    ]);
  });

  it("SC-19: clears sentAt and audienceSnapshot on the copy", async () => {
    await duplicateCampaign("campaign-1");

    expect(createdData()).toMatchObject({
      sentAt: null,
      audienceSnapshot: null,
    });
    expect(createdData().sentAt).not.toEqual(campaign.sentAt);
    expect(createdData().audienceSnapshot).not.toEqual(campaign.audienceSnapshot);
  });

  it("SC-20: duplicates any trigger, not only BROADCAST", async () => {
    campaign = makeCampaign({ trigger: "LEAD_SEGMENT" });

    await duplicateCampaign("campaign-1");

    expect(createdData().trigger).toBe("LEAD_SEGMENT");
    expect(calls.campaignCreate).toHaveLength(1);
  });
});
