import { describe, expect, it } from "bun:test";
import {
  CohortCreateError,
  createCohort,
  type CohortCreateDeps,
  type CohortCreateInput,
} from "@/lib/cohortCreate";

type Row = Record<string, unknown>;

function validInput(overrides: Partial<CohortCreateInput> = {}): CohortCreateInput {
  return {
    title: "Monday Cohort — September 21, 2026",
    description: "A rolling Monday cohort",
    status: "ENROLLMENT",
    deliveryMode: "ONLINE",
    location: null,
    zoomLink: null,
    startDate: new Date("2026-09-21T00:00:00.000Z"),
    endDate: new Date("2026-09-25T00:00:00.000Z"),
    startTime: "9:00 AM",
    endTime: "5:00 PM",
    timezone: "America/Los_Angeles",
    instructorEmails: [],
    programTitles: [],
    rawProgramTitle: null,
    groups: [{ name: "General", price: 0, inPerson: false }],
    requireGroups: true,
    ...overrides,
  };
}

async function rejectedError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    throw new Error("Expected operation to reject");
  } catch (error) {
    return error;
  }
}

describe("createCohort validation", () => {
  it("SC-g: refuses zero required groups and unknown instructor emails with caller-fixable errors", async () => {
    const cohortCreateCalls: Row[] = [];
    const userFindManyCalls: Row[] = [];
    const fakeDb = {
      user: {
        findMany: async (args: Row): Promise<Row[]> => {
          userFindManyCalls.push(args);
          return [];
        },
      },
      program: {
        findMany: async (): Promise<Row[]> => [],
        findFirst: async (): Promise<Row | null> => null,
      },
      cohort: {
        findFirst: async (): Promise<Row | null> => null,
        create: async (args: Row): Promise<Row> => {
          cohortCreateCalls.push(args);
          return { id: "must-not-be-created" };
        },
      },
    };
    // The fake intentionally implements only validation-path Prisma methods.
    const deps = {
      db: fakeDb,
      getSecret: async (): Promise<string | null> => null,
    } as unknown as CohortCreateDeps;

    const groupError = await rejectedError(
      createCohort(validInput({ groups: [], requireGroups: true }), deps)
    );
    expect(groupError).toBeInstanceOf(CohortCreateError);
    expect((groupError as CohortCreateError).status).toBe(400);
    expect((groupError as Error).message).toMatch(/at least one group|groups.*required/i);
    expect(cohortCreateCalls).toHaveLength(0);

    const instructorError = await rejectedError(
      createCohort(
        validInput({ instructorEmails: ["missing-instructor@example.com"] }),
        deps
      )
    );
    expect(instructorError).toBeInstanceOf(CohortCreateError);
    expect((instructorError as CohortCreateError).status).toBe(400);
    expect((instructorError as Error).message).toMatch(
      /instructor.*missing-instructor@example\.com|missing-instructor@example\.com.*not found/i
    );
    expect(userFindManyCalls).toEqual([
      expect.objectContaining({
        where: { email: { in: ["missing-instructor@example.com"] } },
      }),
    ]);
    expect(cohortCreateCalls).toHaveLength(0);
  });
});
