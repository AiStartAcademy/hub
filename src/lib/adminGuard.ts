// src/lib/adminGuard.ts
//
// Shared staff guard for the leads/CRM server actions.
//
// Lives here rather than in a `"use server"` module because such a file may only
// export server actions — exporting the guard from one would publish it as its
// own callable endpoint. A plain module can be imported by all of them.

import { auth } from "@/lib/auth";
import { hasAnyRole, hasRole } from "@/lib/roles";

/** Staff roles that may read and write the leads CRM. */
export const CRM_STAFF_ROLES = ["ADMIN", "TEAM_MEMBER"] as const;

/**
 * Throws unless the caller is staff. Server actions are directly callable HTTP
 * endpoints — this must be the first line of every mutating one.
 */
export async function assertStaff(): Promise<void> {
  const session = await auth();
  if (!hasAnyRole(session?.user, [...CRM_STAFF_ROLES])) {
    throw new Error("Unauthorized");
  }
}

/** Throws unless the caller holds the ADMIN role. */
export async function assertAdmin(): Promise<void> {
  const session = await auth();
  if (!hasRole(session?.user, "ADMIN")) {
    throw new Error("Unauthorized");
  }
}

/** The session's user id and display name, for attributing notes. */
export async function staffIdentity(): Promise<{ id: string | null; label: string }> {
  const session = await auth();
  const user = session?.user as { id?: string; name?: string | null; email?: string | null } | undefined;
  return {
    id: user?.id ?? null,
    label: user?.name?.trim() || user?.email || "Staff",
  };
}
