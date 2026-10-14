// src/lib/programAccess.ts
import prisma from "@/lib/prisma";
import { logger } from "./logger";
import { getMembershipSnapshot, tierAtLeast } from "./entitlements";
import { needsConsent } from "./consent";

export type AccessMode = "cohort" | "direct" | "auth" | "public" | "member";

export const ACCESS_MODES: readonly AccessMode[] = [
  "cohort",
  "direct",
  "auth",
  "public",
  "member",
] as const;

/**
 * Modes where a logged-in user may grant themselves access with one click.
 *
 * This is deliberately short. Being signed in is NOT an entitlement — it says
 * nothing about whether someone paid for a cohort seat, holds a membership, or
 * was granted access by staff. Only the two modes that are free-by-definition
 * are self-serve:
 *
 *   public — content is open to everyone anyway (even guests)
 *   auth   — content is open to any signed-in user by design
 *
 * For `cohort`, `direct`, and `member`, access must come from a real grant
 * (cohort enrollment, admin ProgramAccess record, or an active membership).
 * `enrollInProgram` enforces this server-side; the UI uses it to decide whether
 * to show a self-enroll button or a "here's how to get access" route instead.
 */
export const SELF_ENROLL_MODES: readonly AccessMode[] = ["public", "auth"] as const;

/**
 * Gated modes that may send a viewer through the one-time purchase funnel.
 *
 * A purchase writes a ProgramAccess row, and `decideAccess()` treats grants as
 * additive, so buying works under each mode without re-moding the course.
 */
export const GATED_SELLABLE_MODES = ["cohort", "direct", "member"] as const;

export function isSelfEnrollMode(mode: string): boolean {
  return (SELF_ENROLL_MODES as readonly string[]).includes(mode);
}

/**
 * What a user without access needs to do to get it. Drives the CTA on the
 * program page so we never render a button whose server action will refuse.
 */
export type AccessRoute =
  | "self-enroll"
  | "sign-in"
  | "buy-course"
  | "buy-cohort-seat"
  | "membership"
  | "request-access";

export function accessRouteFor(
  mode: string,
  isAuthenticated: boolean,
  opts?: { sellable?: boolean }
): AccessRoute {
  if (
    opts?.sellable === true &&
    (GATED_SELLABLE_MODES as readonly string[]).includes(mode)
  ) {
    return "buy-course";
  }
  if (!isAuthenticated) return "sign-in";
  if (isSelfEnrollMode(mode)) return "self-enroll";
  if (mode === "member") return "membership";
  if (mode === "direct") return "request-access";
  return "buy-cohort-seat"; // cohort (default)
}

interface ProgramAccessResult {
  hasAccess: boolean;
  /** true if user can see content without logging in (accessMode = "public") */
  isPublicNoAuth: boolean;
  /**
   * true when the ONLY thing standing between this user and the content is unaccepted
   * legal documents. Pages use it to redirect to /consent rather than rendering a
   * "you don't have access" CTA that would send a paying student to buy a second seat.
   */
  needsConsent: boolean;
}

/**
 * Membership access is intentionally two-tiered: recordings are unlocked by any active
 * membership, while 1:1 mentor access is an Accelerator-only perk. Guests simply fail closed.
 */
export async function hasAcceleratorAccess(
  userId: string | undefined
): Promise<boolean> {
  const snap = await getMembershipSnapshot(userId);
  return tierAtLeast(snap, "ACCELERATOR");
}

/**
 * Enrolled in — or grouped into — a cohort whose curriculum includes this program.
 *
 * The link is Program↔Cohort, never the URL, so this is true whether the student
 * arrived via /cohorts/[id] or hit /courses/[programId] directly.
 */
async function hasCohortGrant(programId: string, userId: string): Promise<boolean> {
  const cohort = await prisma.cohort.findFirst({
    where: {
      OR: [
        { enrollments: { some: { userId } } },
        { groups: { some: { members: { some: { userId } } } } },
      ],
      AND: [
        {
          OR: [
            { programs: { some: { id: programId } } },
            { rawProgramId: programId },
          ],
        },
      ],
    },
    select: { id: true },
  });
  return !!cohort;
}

/** Staff-issued per-user grant (POST /api/admin/programs/[programId]/access). */
async function hasDirectGrant(programId: string, userId: string): Promise<boolean> {
  const row = await prisma.programAccess.findUnique({
    where: { programId_userId: { programId, userId } },
    select: { id: true },
  });
  return !!row;
}

/**
 * The entitlement decision itself, as a pure function of already-resolved facts.
 *
 * Access sources are ADDITIVE: a real grant (cohort enrollment or a staff-issued
 * ProgramAccess row) always counts, and `accessMode` only widens the audience
 * beyond it. Modes therefore form a permissiveness ladder — cohort ⊂ direct ⊂
 * member — and no mode can take access away from someone who was granted it.
 *
 * This used to be false for `member`, which checked the membership snapshot and
 * nothing else. A course can legitimately serve two audiences at once (a paid
 * recordings product AND a cohort's curriculum), and every cohort student
 * without a subscription was locked out of such a course — page, lesson, and
 * signed media bytes alike. Kept separate from the I/O above so the truth table
 * is unit-testable; see tests/unit/programAccess.test.ts.
 */
export function decideAccess(facts: {
  mode: string;
  isAuthenticated: boolean;
  hasCohortGrant: boolean;
  hasDirectGrant: boolean;
  meetsMemberTier: boolean;
}): boolean {
  switch (facts.mode) {
    case "public":
      return true;
    case "auth":
      return facts.isAuthenticated;
    case "cohort":
      return facts.hasCohortGrant;
    case "direct":
      return facts.hasCohortGrant || facts.hasDirectGrant;
    case "member":
      return facts.meetsMemberTier || facts.hasCohortGrant || facts.hasDirectGrant;
    default:
      // A typo'd or future accessMode must never accidentally grant access.
      return false;
  }
}

/**
 * Checks whether a user (or guest) has access to a program
 * based on the program's accessMode.
 *
 * A cohort enrollment or a ProgramAccess grant is honoured under every mode that
 * requires a grant at all; accessMode adds an audience on top:
 *   cohort — grants only: cohort enrollment (default, strictest)
 *   direct — grants only: cohort enrollment OR explicit ProgramAccess record
 *   member — grants, PLUS any user with an active membership >= memberMinTier
 *   auth   — any authenticated user
 *   public — everyone, including unauthenticated guests
 */
async function resolveBaseAccess(
  programId: string,
  userId: string | undefined
): Promise<Omit<ProgramAccessResult, "needsConsent">> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { accessMode: true, memberMinTier: true },
  });

  if (!program) {
    return { hasAccess: false, isPublicNoAuth: false };
  }

  const mode = program.accessMode as AccessMode;

  // public — everyone can access, no login required
  if (mode === "public") {
    logger.info(`[checkProgramAccess] Program ${programId} is fully public`);
    return { hasAccess: true, isPublicNoAuth: true };
  }

  // Every remaining mode requires a signed-in user.
  if (!userId) return { hasAccess: false, isPublicNoAuth: false };

  // auth — any logged-in user; no grant lookup needed.
  if (mode === "auth") {
    logger.info(
      `[checkProgramAccess] Program ${programId} mode=auth, userId=${userId}, granted=true`
    );
    return { hasAccess: true, isPublicNoAuth: false };
  }

  // Resolve only the facts this mode can actually use, in one round trip.
  //
  // NOTE: ProgramEnrollment is deliberately NOT consulted as a grant.
  //
  // It is only ever created by the self-serve `enrollInProgram` action, whose
  // button renders exclusively when the viewer does NOT already have access.
  // So every ProgramEnrollment row on a gated program is, by construction,
  // someone who lacked access granting it to themselves — the exact bypass
  // these modes exist to prevent. A genuine cohort student is already covered
  // by `hasCohortGrant`.
  //
  // ProgramEnrollment now means "in my courses / track my progress" and never
  // "entitled". To find users who were relying on the old behaviour and grant
  // them access properly, run `scripts/audit-program-access.ts`.
  const [cohortGrant, directGrant, snap] = await Promise.all([
    hasCohortGrant(programId, userId),
    mode === "cohort" ? Promise.resolve(false) : hasDirectGrant(programId, userId),
    mode === "member" ? getMembershipSnapshot(userId) : Promise.resolve(null),
  ]);

  // member — an active membership, optionally gated to a minimum tier via
  // Program.memberMinTier (null = any tier). Tier rules live in entitlements.ts.
  const meetsMemberTier = snap ? tierAtLeast(snap, program.memberMinTier) : false;

  const granted = decideAccess({
    mode,
    isAuthenticated: true,
    hasCohortGrant: cohortGrant,
    hasDirectGrant: directGrant,
    meetsMemberTier,
  });

  // Every fact on one line: triaging "why is this student locked out" should be a
  // log grep, not a code read.
  logger.info(
    `[checkProgramAccess] Program ${programId} mode=${mode}, userId=${userId}, ` +
      `cohort=${cohortGrant}, direct=${directGrant}, ` +
      `tier=${snap?.tier ?? "none"}, minTier=${program.memberMinTier ?? "any"}, granted=${granted}`
  );
  return { hasAccess: granted, isPublicNoAuth: false };
}

/**
 * Entitlement check plus the student consent gate.
 *
 * The consent gate lives here, wrapping the entitlement logic, because this is the one
 * choke point every content path already goes through — the program page, the lesson
 * viewer, the modules/complete/quiz APIs, and (the one that actually matters) the signed
 * media route. Gating anywhere else would leave the media URLs reachable.
 *
 * Guests and fully-public programs are never gated: consent is a student obligation, and
 * walling free lead-magnet content behind a login-only form would break the funnel.
 */
export async function checkProgramAccess(
  programId: string,
  userId: string | undefined
): Promise<ProgramAccessResult> {
  const base = await resolveBaseAccess(programId, userId);

  if (!base.hasAccess || base.isPublicNoAuth || !userId) {
    return { ...base, needsConsent: false };
  }

  if (!(await needsConsent(userId))) {
    return { ...base, needsConsent: false };
  }

  logger.info(
    `[checkProgramAccess] Program ${programId} withheld from userId=${userId}: consent outstanding`
  );
  return { hasAccess: false, isPublicNoAuth: false, needsConsent: true };
}
