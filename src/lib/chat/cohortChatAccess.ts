// src/lib/chat/cohortChatAccess.ts
//
// Pure decision logic for cohort chat. Kept free of Prisma/next-auth so the
// rules are unit-testable and so the API route and the page selector cannot
// drift apart — they both answer "may this person see this cohort's chat?"
// the same way.

import { MANAGE_ROLES, hasAnyRole } from "@/lib/roles";

/** Legacy slug rule — must stay byte-identical to RocketChatService.syncCohortGroup,
 *  otherwise existing groups get orphaned. Lowercase, any non [a-z0-9] → one dash. */
export function slugifyCohortChannel(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

/** The RC group name for a cohort. Prefers the name persisted at creation time,
 *  so renaming a cohort in the hub does not point chat at a different (empty) group. */
export function cohortChannelName(cohort: {
  title: string;
  rocketchatChannelName?: string | null;
}): string {
  if (cohort.rocketchatChannelName) return cohort.rocketchatChannelName;
  return `cohort-${slugifyCohortChannel(cohort.title)}`;
}

/** Mirrors the enrolment check in app/(dashboard)/cohorts/[id]/page.tsx:
 *  a group membership OR an enrollment row makes you a member; staff always pass. */
export function canAccessCohortChat(input: {
  user: { roles?: unknown; role?: unknown } | null | undefined;
  groupMemberCount: number;
  enrollmentCount: number;
}): boolean {
  if (!input.user) return false;
  if (hasAnyRole(input.user as never, MANAGE_ROLES)) return true;
  return input.groupMemberCount > 0 || input.enrollmentCount > 0;
}
