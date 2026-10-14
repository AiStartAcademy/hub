import { describe, expect, it } from "bun:test";
import type { CohortCreateInput } from "@/lib/cohortCreate";
import {
  ensureRollingCohorts,
  mondayCohortSlug,
  nextMondays,
} from "@/lib/cohortRoll";

type Row = Record<string, unknown>;

interface RollHarness {
  db: {
    cohort: {
      findUnique(args: Row): Promise<Row | null>;
      findMany(args: Row): Promise<Row[]>;
    };
    cohortSession: { create(args: Row): Promise<Row> };
    sessionSeries: { findFirst(args: Row): Promise<Row | null> };
    sessionSeriesCohort: { create(args: Row): Promise<Row> };
  };
  createInputs: CohortCreateInput[];
  cohortsBySlug: Map<string, Row>;
  sessionCreates: Row[];
  seriesAttachCreates: Row[];
  seriesFindFirstCalls: Row[];
  createCohort(input: CohortCreateInput): Promise<Row>;
}

function rowData(args: Row): Row {
  return (args.data ?? {}) as Row;
}

function makeHarness(activeCheckinSeries: Row | null = null): RollHarness {
  const createInputs: CohortCreateInput[] = [];
  const cohortsBySlug = new Map<string, Row>();
  const sessionCreates: Row[] = [];
  const seriesAttachCreates: Row[] = [];
  const seriesFindFirstCalls: Row[] = [];
  let cohortSequence = 0;

  const db = {
    cohort: {
      findUnique: async (args: Row): Promise<Row | null> => {
        const where = (args.where ?? {}) as Row;
        return cohortsBySlug.get(String(where.slug)) ?? null;
      },
      findMany: async (args: Row): Promise<Row[]> => {
        const where = (args.where ?? {}) as Row;
        const slugFilter = (where.slug ?? {}) as Row;
        const slugs = Array.isArray(slugFilter.in)
          ? (slugFilter.in as string[])
          : [];
        return slugs
          .map((slug) => cohortsBySlug.get(slug))
          .filter((row): row is Row => row !== undefined);
      },
    },
    cohortSession: {
      create: async (args: Row): Promise<Row> => {
        sessionCreates.push(args);
        return { id: `session-${sessionCreates.length}`, ...rowData(args) };
      },
    },
    sessionSeries: {
      findFirst: async (args: Row): Promise<Row | null> => {
        seriesFindFirstCalls.push(args);
        return activeCheckinSeries;
      },
    },
    sessionSeriesCohort: {
      create: async (args: Row): Promise<Row> => {
        seriesAttachCreates.push(args);
        return rowData(args);
      },
    },
  };

  const createCohort = async (input: CohortCreateInput): Promise<Row> => {
    createInputs.push(input);
    const startDate = input.startDate;
    if (!startDate) throw new Error("Rolling cohorts require a startDate");
    const slug = mondayCohortSlug(startDate);
    const row = {
      id: `cohort-${++cohortSequence}`,
      slug,
      title: input.title,
      status: input.status ?? "DRAFT",
      startDate,
      groups: input.groups.map((group, index) => ({
        id: `group-${cohortSequence}-${index + 1}`,
        ...group,
      })),
    };
    cohortsBySlug.set(slug, row);
    return row;
  };

  return {
    db,
    createInputs,
    cohortsBySlug,
    sessionCreates,
    seriesAttachCreates,
    seriesFindFirstCalls,
    createCohort,
  };
}

function rollDeps(harness: RollHarness): NonNullable<
  Parameters<typeof ensureRollingCohorts>[1]
> {
  // The production dependency contract is intentionally Prisma-shaped; this
  // cast lets the test provide only the methods that this unit is allowed to use.
  return {
    db: harness.db,
    createCohort: harness.createCohort,
  } as unknown as NonNullable<Parameters<typeof ensureRollingCohorts>[1]>;
}

describe("Monday rolling cohorts", () => {
  it("SC-a: creates exactly six cohorts for the next six Mondays in America/Los_Angeles", async () => {
    const harness = makeHarness();
    const result = await ensureRollingCohorts(
      { weeks: 6, now: new Date("2026-09-16T19:00:00.000Z") },
      rollDeps(harness)
    );

    expect(harness.createInputs).toHaveLength(6);
    expect(harness.cohortsBySlug.size).toBe(6);
    expect(result.created).toHaveLength(6);
    expect(
      harness.createInputs.map((input) => input.startDate?.toISOString())
    ).toEqual([
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
      "2026-10-12T00:00:00.000Z",
      "2026-10-19T00:00:00.000Z",
      "2026-10-26T00:00:00.000Z",
    ]);
  });

  it("SC-b: a second roll skips deterministic slugs even when existing titles differ", async () => {
    const harness = makeHarness();
    const opts = {
      weeks: 3,
      now: new Date("2026-09-16T19:00:00.000Z"),
    };

    const first = await ensureRollingCohorts(opts, rollDeps(harness));
    for (const cohort of harness.cohortsBySlug.values()) {
      cohort.title = "A deliberately renamed cohort";
    }
    const second = await ensureRollingCohorts(opts, rollDeps(harness));

    expect(first.created).toHaveLength(3);
    expect(harness.createInputs).toHaveLength(3);
    expect(harness.cohortsBySlug.size).toBe(3);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(3);
    expect(
      nextMondays(opts.now, opts.weeks).map((date) => mondayCohortSlug(date))
    ).toEqual([...harness.cohortsBySlug.keys()]);
  });

  it("SC-c: every generated cohort is open for enrollment and has at least one group", async () => {
    const harness = makeHarness();

    await ensureRollingCohorts(
      { weeks: 4, now: new Date("2026-09-16T19:00:00.000Z") },
      rollDeps(harness)
    );

    expect(harness.createInputs).toHaveLength(4);
    for (const input of harness.createInputs) {
      expect(input.status).toBe("ENROLLMENT");
      expect(input.groups.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("SC-d: PT Monday includes itself, while PT Sunday that is Monday in UTC uses the following PT Monday", () => {
    // 2026-09-21 at noon PDT is unambiguously Monday in both PT and UTC, so
    // the current PT calendar day must be included rather than advanced a week.
    const mondayNoonPt = new Date("2026-09-21T19:00:00.000Z");
    expect(nextMondays(mondayNoonPt, 2).map((date) => date.toISOString())).toEqual([
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ]);

    // 2026-09-21 02:00Z is still Sunday 2026-09-20 at 7 PM PDT. Computing
    // from UTC's weekday would incorrectly call Sep 21 "today"; in PT it is
    // the following Monday and must still be the first generated date.
    const sundayEveningPtAlreadyMondayUtc = new Date("2026-09-21T02:00:00.000Z");
    expect(
      nextMondays(sundayEveningPtAlreadyMondayUtc, 2).map((date) =>
        date.toISOString()
      )
    ).toEqual([
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ]);
  });

  it("SC-e: each generated cohort receives exactly one authored onboarding session without a Zoom occurrence id", async () => {
    const harness = makeHarness();

    await ensureRollingCohorts(
      { weeks: 3, now: new Date("2026-09-16T19:00:00.000Z") },
      rollDeps(harness)
    );

    expect(harness.sessionCreates).toHaveLength(3);
    const createdCohortIds = new Set(
      [...harness.cohortsBySlug.values()].map((cohort) => cohort.id)
    );
    for (const call of harness.sessionCreates) {
      const data = rowData(call);
      expect(createdCohortIds.has(data.cohortId)).toBe(true);
      expect(data.title).toMatch(/onboarding/i);
      expect(data.zoomOccurrenceId).toBeNull();
    }
    expect(
      harness.sessionCreates.map((call) => rowData(call).cohortId).sort()
    ).toEqual([...createdCohortIds].sort());
  });

  it("SC-f: attaches new cohorts to the active CHECKIN series, or succeeds with a warning when none exists", async () => {
    const withSeries = makeHarness({
      id: "checkin-series-1",
      kind: "CHECKIN",
      status: "ACTIVE",
    });

    const attached = await ensureRollingCohorts(
      { weeks: 2, now: new Date("2026-09-16T19:00:00.000Z") },
      rollDeps(withSeries)
    );

    expect(attached.created).toHaveLength(2);
    expect(withSeries.seriesFindFirstCalls.length).toBeGreaterThanOrEqual(1);
    expect(withSeries.seriesFindFirstCalls[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ kind: "CHECKIN", status: "ACTIVE" }),
      })
    );
    expect(withSeries.seriesAttachCreates).toHaveLength(2);
    expect(
      withSeries.seriesAttachCreates.map((call) => rowData(call))
    ).toEqual(
      [...withSeries.cohortsBySlug.values()].map((cohort) => ({
        seriesId: "checkin-series-1",
        cohortId: cohort.id,
      }))
    );

    const withoutSeries = makeHarness();
    const warned = await ensureRollingCohorts(
      { weeks: 2, now: new Date("2026-09-16T19:00:00.000Z") },
      rollDeps(withoutSeries)
    );

    expect(warned.created).toHaveLength(2);
    expect(withoutSeries.seriesAttachCreates).toHaveLength(0);
    expect(
      warned.warnings.some((warning) =>
        /active.*check.?in|check.?in.*active/i.test(warning)
      )
    ).toBe(true);
  });
});
