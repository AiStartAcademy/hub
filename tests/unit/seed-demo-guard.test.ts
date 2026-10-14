import { describe, expect, test } from "bun:test";

import {
  assertSeedAllowed,
  demoCohortWindow,
  demoSessionDates,
  parseSeedArgs,
} from "../../src/lib/seedDemoGuard";

describe("demo seed safety guard", () => {
  test("SC-1: refuses production without --force and explains the override", () => {
    expect(() =>
      assertSeedAllowed({
        nodeEnv: "production",
        databaseUrl: "file:./dev.db",
        force: false,
      }),
    ).toThrow(/production.*--force/i);
  });

  test("SC-2: refuses missing, empty, and non-file database URLs without --force", () => {
    const disallowedUrls = [undefined, "", "postgresql://localhost/demo", "mysql://localhost/demo"];

    for (const databaseUrl of disallowedUrls) {
      expect(() =>
        assertSeedAllowed({ nodeEnv: "development", databaseUrl, force: false }),
      ).toThrow(/database_url.*file:.*--force/i);
    }
  });

  test("SC-3: allows only exact development and test NODE_ENV values without --force", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(() =>
        assertSeedAllowed({ nodeEnv, databaseUrl: "file:./dev.db", force: false }),
      ).not.toThrow();
    }

    const disallowedEnvironments = [undefined, "", "production", "staging", "qa", "Development"];
    for (const nodeEnv of disallowedEnvironments) {
      const actualValue = nodeEnv === undefined ? "undefined" : JSON.stringify(nodeEnv);
      expect(() =>
        assertSeedAllowed({ nodeEnv, databaseUrl: "file:./dev.db", force: false }),
      ).toThrow(new RegExp(`${actualValue}.*--force`, "i"));
    }
  });

  test("SC-4: --force overrides production and non-file URL refusals", () => {
    expect(() =>
      assertSeedAllowed({
        nodeEnv: "production",
        databaseUrl: "postgresql://localhost/demo",
        force: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertSeedAllowed({ nodeEnv: "development", databaseUrl: undefined, force: true }),
    ).not.toThrow();
  });

  test("SC-5: parses --force only when the exact flag is present", () => {
    expect(parseSeedArgs([])).toEqual({ force: false });
    expect(parseSeedArgs(["--force"])).toEqual({ force: true });
    expect(parseSeedArgs(["--dry-run", "--force"])).toEqual({ force: true });
    expect(parseSeedArgs(["--force=true", "force", "--forced"])).toEqual({ force: false });
  });
});

describe("demo cohort dates", () => {
  test("SC-6: returns three future 17:00-UTC sessions (same calendar day from the Americas to Europe) two days apart and their window", () => {
    const now = new Date("2026-10-13T23:45:00.000Z");
    const dates = demoSessionDates(now);

    expect(dates).toHaveLength(3);
    expect(dates.map((date) => date.toISOString())).toEqual([
      "2026-10-20T17:00:00.000Z",
      "2026-10-22T17:00:00.000Z",
      "2026-10-24T17:00:00.000Z",
    ]);
    expect(dates.every((date) => date.getTime() > now.getTime())).toBe(true);
    expect(dates.every((date) =>
      date.getUTCHours() === 17 &&
      date.getUTCMinutes() === 0 &&
      date.getUTCSeconds() === 0 &&
      date.getUTCMilliseconds() === 0,
    )).toBe(true);
    expect(dates[0]!.getTime()).toBeLessThan(dates[1]!.getTime());
    expect(dates[1]!.getTime()).toBeLessThan(dates[2]!.getTime());

    const sameDayLater = demoSessionDates(new Date("2026-10-13T23:59:59.999Z"));
    expect(sameDayLater).toEqual(dates);

    const window = demoCohortWindow(now);
    expect(window).toEqual({ startDate: dates[0], endDate: dates[2] });
    expect(() => demoSessionDates(new Date(Number.NaN))).toThrow(/invalid date/i);
  });
});
