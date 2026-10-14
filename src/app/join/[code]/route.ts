// src/app/join/[code]/route.ts
//
// Shareable discount link: example.com/join/CODE — what goes on a QR
// poster, in an ambassador's share link, and in the cart-recovery email.
// Public and unauthenticated by design.
//
// It validates the code, drops it in a first-touch cookie, and sends the
// visitor to the page where they can actually buy. Checkout reads the cookie
// and pre-applies the discount, so the code survives the visitor browsing
// around before deciding — and survives them landing on a cohort page from a
// printed poster with no query string.
//
// Rule: an unknown or dead code is never an error page. The visitor came from
// a poster or a friend; they land on the cohorts page and can still buy at
// full price. Only a *valid* code sets the cookie, so a typo can't poison a
// later checkout.

import { NextRequest, NextResponse } from "next/server";
import { REF_COOKIE, REF_COOKIE_MAX_AGE_DAYS } from "@/lib/attribution";
import { normalizeCouponCode, validateCode } from "@/lib/coupons";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    ""
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const base = appUrl();
  let destination = `${base}/cohorts`;
  let validCode: string | null = null;

  try {
    const { code: rawCode } = await params;
    const code = normalizeCouponCode(rawCode);

    if (code) {
      // Validated against the cohort context because that is the common case;
      // membership-only codes still resolve below via their own lookup. A code
      // that fails here simply doesn't get cookied.
      const coupon = await prisma.coupon.findUnique({
        where: { code },
        select: { code: true, appliesTo: true, cohortId: true },
      });

      if (coupon) {
        const usable = await validateCode(code, {
          appliesTo: coupon.appliesTo === "membership" ? "membership" : "cohort",
          cohortId: coupon.cohortId,
        });
        if (usable) {
          validCode = usable.code;
          if (usable.appliesTo === "membership") {
            destination = `${base}/membership`;
          } else if (usable.cohortId) {
            const cohort = await prisma.cohort.findUnique({
              where: { id: usable.cohortId },
              select: { slug: true, id: true },
            });
            if (cohort) {
              destination = `${base}/cohorts/${cohort.slug || cohort.id}`;
            }
          }
        }
      }
    }
  } catch (error) {
    // A lookup failure must not strand a visitor who scanned a poster.
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "join link lookup failed"
    );
  }

  const res = NextResponse.redirect(destination, 307);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");

  if (validCode) {
    res.cookies.set(REF_COOKIE, validCode, {
      maxAge: REF_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
    });
  }

  return res;
}
