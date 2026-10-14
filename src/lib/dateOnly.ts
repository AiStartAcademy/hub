const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validates and normalizes an optional ISO calendar date without timezone conversion. */
export function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== "string") {
    throw new Error("Birthday must be an ISO date in YYYY-MM-DD format");
  }

  const normalized = value.trim();
  if (!normalized) return null;

  const match = ISO_DATE_ONLY.exec(normalized);
  if (!match) {
    throw new Error("Birthday must be an ISO date in YYYY-MM-DD format");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Birthday must be a real calendar date");
  }

  return normalized;
}
