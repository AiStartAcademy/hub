// src/lib/consent.ts
//
// Student consent gate. A paid student is enrolled by the Stripe webhook with no
// browser present and often no password yet, so consent cannot be collected at
// enrollment time — it is enforced the first time they reach course content, via
// checkProgramAccess().
import "server-only";

import { cache } from "react";

import prisma from "@/lib/prisma";
import {
  LEGAL_DOCS,
  LegalDocKey,
  requiredDocsFor,
} from "@/lib/legalDocs";

/**
 * Kill switch. The gate blocks access to paid content, so a bad deploy locks out an
 * entire cohort — this exists so that can be undone in one env change, without a
 * rollback. Acceptances are still recorded while it is off; only enforcement stops.
 *
 * Defaults to OFF so the page and endpoint can ship and be exercised before the block
 * is switched on (see "Backfill" in Plans/frolicking-jumping-narwhal.md).
 */
export function consentGateEnabled(): boolean {
  return process.env.CONSENT_GATE_ENABLED === "true";
}

const IN_PERSON_MODES = new Set(["INPERSON", "HYBRID"]);

/**
 * Documents this user still owes, at the current version. Empty array = fully consented.
 *
 * `cache` memoises per request, which matters: a single lesson page render calls
 * checkProgramAccess from the page, from the media route for each asset, and again on
 * completion — all inside one request.
 */
export const getOutstandingConsents = cache(
  async (userId: string): Promise<LegalDocKey[]> => {
    const [enrollments, accepted] = await Promise.all([
      prisma.enrollment.findMany({
        where: { userId, status: { not: "dropped" } },
        select: { cohort: { select: { deliveryMode: true } } },
      }),
      prisma.userConsent.findMany({
        where: { userId },
        select: { docKey: true, version: true },
      }),
    ]);

    const inPerson = enrollments.some((e) =>
      IN_PERSON_MODES.has(e.cohort.deliveryMode)
    );

    const acceptedAtCurrentVersion = new Set(
      accepted
        .filter((row) => LEGAL_DOCS[row.docKey as LegalDocKey]?.version === row.version)
        .map((row) => row.docKey)
    );

    return requiredDocsFor({ inPerson }).filter(
      (key) => !acceptedAtCurrentVersion.has(key)
    );
  }
);

/** True when this user should be redirected to /consent before seeing content. */
export async function needsConsent(userId: string | undefined): Promise<boolean> {
  if (!userId || !consentGateEnabled()) return false;
  return (await getOutstandingConsents(userId)).length > 0;
}

/** The cohort to attribute an acceptance to — most recent active enrollment, if any. */
export async function consentCohortId(userId: string): Promise<string | null> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId, status: { not: "dropped" } },
    orderBy: { createdAt: "desc" },
    select: { cohortId: true },
  });
  return enrollment?.cohortId ?? null;
}
