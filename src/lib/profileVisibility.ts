/**
 * The profile visibility enum, shared by every writer of `User.profileVisibility`.
 *
 * Lived as a local const in the admin profile route until the MCP profile route
 * needed the same check; a second copy would have been a drift hazard on a field
 * that decides whether a person's page is world-readable.
 */

export const PROFILE_VISIBILITIES = ["PRIVATE", "PUBLIC", "UNLISTED"] as const;

export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

/** True when `value` is one of the three known visibility strings. */
export function isProfileVisibility(value: unknown): value is ProfileVisibility {
  return (
    typeof value === "string" && PROFILE_VISIBILITIES.includes(value as ProfileVisibility)
  );
}

/** Visibility values that put the profile within reach of a non-admin visitor. */
export function isPubliclyReachable(value: string | null | undefined): boolean {
  return value === "PUBLIC" || value === "UNLISTED";
}
