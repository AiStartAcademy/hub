// src/lib/roles.ts
//
// Single source of truth for "does this user have role X". A user can hold
// multiple roles (User.roles, JSON string[]); User.role stays as the legacy
// primary/display role. Every permission check in the app goes through
// hasRole()/hasAnyRole() instead of comparing .role directly — see
// docs/features/USER_ROLES.md.

export const ROLE_VALUES = ["STUDENT", "EVENT_ORGANIZER", "TEAM_MEMBER", "INSTRUCTOR", "ADMIN"] as const;
export type RoleValue = (typeof ROLE_VALUES)[number];

export const ADMIN_ROLES: RoleValue[] = ["ADMIN"];
export const MANAGE_ROLES: RoleValue[] = ["TEAM_MEMBER", "INSTRUCTOR", "ADMIN"];
// Same set as MANAGE_ROLES, kept as an alias so files that already spoke of
// "staff" don't need to rename their imported constant.
export const STAFF_ROLES = MANAGE_ROLES;

type RoleBearer = { role?: string | null; roles?: string | string[] | null } | null | undefined;

/** Accepts whatever shape a call site already has on hand: a bare legacy role
 *  string, an already-resolved roles array, or a user/session.user-shaped object. */
export type RoleSource = string | string[] | RoleBearer;

function parseRolesJson(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string" && r.length > 0) : [];
  } catch {
    return [];
  }
}

/** Resolve the effective role set for a source, falling back to the legacy
 *  single `role` field whenever `roles` is empty/missing/malformed. Never
 *  widens to "all roles" — an unreadable value resolves to `[]`, not ALL_ROLES. */
export function getRoles(source: RoleSource): string[] {
  if (source == null) return [];
  if (typeof source === "string") return source ? [source] : [];
  if (Array.isArray(source)) return source.filter(Boolean);

  const fromRoles = parseRolesJson(source.roles ?? null);
  if (fromRoles.length > 0) return fromRoles;
  return source.role ? [source.role] : [];
}

export function hasRole(source: RoleSource, role: string): boolean {
  return getRoles(source).includes(role);
}

export function hasAnyRole(source: RoleSource, allowed: readonly string[]): boolean {
  const roles = getRoles(source);
  return roles.some((r) => allowed.includes(r));
}

/** The role shown as "the" role in single-value UI (badges, sort, etc). */
export function primaryRole(source: RoleSource): string {
  const roles = getRoles(source);
  return roles[0] ?? "STUDENT";
}

export function isValidRole(value: unknown): value is RoleValue {
  return typeof value === "string" && (ROLE_VALUES as readonly string[]).includes(value);
}

/** Serialize a roles array for storage in User.roles. */
export function serializeRoles(roles: readonly string[]): string {
  return JSON.stringify(roles);
}
