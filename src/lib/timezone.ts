/**
 * IANA timezone validation.
 *
 * `User.timezone` and `Cohort.timezone` are handed straight to `Intl` by
 * `sessionTime.ts`, so a non-IANA string ("PT", "PST", "Pacific") silently
 * fails to format at render time rather than at write time. Anything that
 * accepts a timezone from outside the app should validate here first.
 */

/** True when `value` is a timezone identifier `Intl` will accept, e.g. "America/Los_Angeles". */
export function isValidIanaTimezone(value: string): boolean {
  if (!value) return false;
  try {
    // Throws RangeError on an unknown identifier. UTC is accepted by every runtime.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
