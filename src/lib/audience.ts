// Audience resolution for the View convention (docs/features/VIEWS.md).
// A route's server page resolves the viewer's audience for a given object, then
// renders the mapped view. The vocabulary is shared; "enrolled" is object-specific
// so each object gets a small resolver that supplies it.

import { MANAGE_ROLES, hasAnyRole, primaryRole } from "./roles";

export type Audience = "guest" | "student" | "member" | "manager";

type SessionLike = { user?: { id?: string; role?: string | null; roles?: string | string[] | null } | null } | null;

/**
 * Resolve the viewer's audience for a cohort.
 * - `manager`  → staff (TEAM_MEMBER/INSTRUCTOR/ADMIN): full ManageView workspace.
 * - `member`   → a student enrolled in THIS cohort: ManageView (their learning space).
 * - `student`  → signed-in but not enrolled here: PublicView (convert).
 * - `guest`    → logged out: PublicView (convert).
 */
export function resolveCohortAudience(
  session: SessionLike,
  ctx: { enrolled: boolean }
): Audience {
  if (!session?.user) return "guest";
  if (hasAnyRole(session.user, MANAGE_ROLES)) return "manager";
  if (ctx.enrolled) return "member";
  if (primaryRole(session.user) === "STUDENT") return "student";
  return "guest";
}

/** The two audiences that get the private workspace view. */
export function isWorkspaceAudience(a: Audience): boolean {
  return a === "manager" || a === "member";
}

// NOTE — no `resolveProfileAudience` here, deliberately.
//
// Human profiles (docs/features/HUMANS.md) look like they want one, and VIEWS.md maps three
// views for them, but the two live view branches are decided by facts that aren't an audience:
// which view you get is `isMentor` (a capability flag on the profile, not a property of the
// viewer), and whether a PRIVATE profile is reachable at all is `canViewUserData` — ADMIN only
// in v1.
//
// A resolver here would return "manager" for all of MANAGE_ROLES (TEAM_MEMBER/INSTRUCTOR/ADMIN),
// which is strictly wider than that gate. Shipping it unused invites exactly one bug: someone
// wires the reachability check to `audience === "manager"` and quietly exposes every PRIVATE
// profile to all staff. Add the resolver when `OwnerEditView` is actually built, and make its
// privileged tier agree with `canViewUserData` on that day.
