export interface SeedGuardInput {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  force: boolean;
}

export interface DemoCohortWindow {
  startDate: Date;
  endDate: Date;
}

const HOUR_IN_MS = 60 * 60 * 1_000;
const DAY_IN_MS = 24 * HOUR_IN_MS;

export function assertSeedAllowed(input: SeedGuardInput): void {
  if (input.force) return;

  if (input.nodeEnv !== "development" && input.nodeEnv !== "test") {
    const actualNodeEnv = input.nodeEnv === undefined ? "undefined" : JSON.stringify(input.nodeEnv);
    throw new Error(
      `Demo seed refused: NODE_ENV is ${actualNodeEnv}; expected exactly "development" or "test". Pass --force to override this safety check.`,
    );
  }

  if (!input.databaseUrl || !input.databaseUrl.startsWith("file:")) {
    throw new Error(
      "Demo seed refused: DATABASE_URL must be a non-empty SQLite file: URL. Pass --force to override this safety check.",
    );
  }
}

export function parseSeedArgs(argv: string[]): { force: boolean } {
  return { force: argv.includes("--force") };
}

export function demoSessionDates(now: Date): Date[] {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Cannot calculate demo session dates from an invalid date.");
  }

  const utcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // 17:00 UTC falls on the same calendar day from the Americas through Europe.
  return [7, 9, 11].map((daysAfter) => new Date(utcDay + daysAfter * DAY_IN_MS + 17 * HOUR_IN_MS));
}

export function demoCohortWindow(now: Date): DemoCohortWindow {
  const dates = demoSessionDates(now);
  return { startDate: dates[0]!, endDate: dates[2]! };
}
