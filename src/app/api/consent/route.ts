// src/app/api/consent/route.ts
//
// Records a student's acceptance of the required legal documents.
//
// The client tells us WHICH documents it showed, but never what was required — the
// required set is recomputed server-side from the user's enrollments, the same way the
// venue agreement sign route re-derives its fields from the stored document rather than
// trusting the submitted keys. Otherwise a crafted POST could "accept" nothing and open
// the gate.
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rateLimit";
import { LEGAL_DOCS, isLegalDocKey } from "@/lib/legalDocs";
import { consentCohortId, getOutstandingConsents } from "@/lib/consent";

export const dynamic = "force-dynamic";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return "unknown";
  const [firstIp] = forwardedFor.split(",");
  const trimmed = firstIp?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "unknown";
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`consent:${userId}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payload = (body ?? {}) as {
    acceptedDocKeys?: unknown;
    marketingRelease?: unknown;
  };

  const submitted = new Set(
    (Array.isArray(payload.acceptedDocKeys) ? payload.acceptedDocKeys : []).filter(
      isLegalDocKey
    )
  );

  // Authoritative list — never the client's.
  const outstanding = await getOutstandingConsents(userId);
  const missing = outstanding.filter((key) => !submitted.has(key));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "You must accept all required policies to continue.",
        missing,
      },
      { status: 400 }
    );
  }

  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
  const cohortId = await consentCohortId(userId);

  // Part B of the media release is optional and lives on User, not UserConsent — a
  // student who declines still gets a "recording" consent row for Part A.
  const marketingRelease = payload.marketingRelease === true;

  try {
    await prisma.$transaction([
      prisma.userConsent.createMany({
        // `outstanding` only, so a re-submit after everything is on file writes nothing.
        // (No skipDuplicates here — Prisma doesn't support it on SQLite. The unique
        // constraint plus the P2002 handling below is what makes this idempotent.)
        data: outstanding.map((key) => ({
          userId,
          docKey: key,
          version: LEGAL_DOCS[key].version,
          ip,
          userAgent,
          cohortId,
        })),
      }),
      prisma.user.update({
        where: { id: userId },
        // Withdrawal is handled by staff on request; a student unchecking the box on a
        // later re-prompt clears it here too, which is the behaviour we want.
        data: { marketingReleaseAt: marketingRelease ? new Date() : null },
      }),
    ]);
  } catch (error) {
    // P2002 = unique violation on (userId, docKey, version): a double-submit raced us
    // and the consent is already recorded. That is the desired end state, not an error.
    if ((error as { code?: string })?.code === "P2002") {
      logger.info(`[consent] Duplicate submit for ${userId} — already recorded`);
      return NextResponse.json({ ok: true, accepted: outstanding });
    }
    logger.error(`[consent] Failed to record consent for ${userId}: ${String(error)}`);
    return NextResponse.json({ error: "Could not record consent" }, { status: 500 });
  }

  logger.info(
    `[consent] userId=${userId} accepted=[${outstanding.join(",")}] marketingRelease=${marketingRelease} ip=${ip}`
  );

  return NextResponse.json({ ok: true, accepted: outstanding });
}
