import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/client";
import { auth, canViewUserData, canEditUserData } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uniqueUserSlug } from "@/lib/slug";
import { PROFILE_VISIBILITIES, type ProfileVisibility } from "@/lib/profileVisibility";
import { isValidIanaTimezone } from "@/lib/timezone";
import {
  InvalidPhoneError,
  resolvePersonContact,
  setPersonPhone,
} from "@/lib/leads/personRecord";
import { logger } from "@/lib/logger";

/** Coerce any value to a trimmed string ("" when nullish). */
function str(value: unknown): string {
  return String(value ?? "").trim();
}

/** Coerce to a trimmed string, or null when empty — for nullable columns. */
function strOrNull(value: unknown): string | null {
  const s = str(value);
  return s.length > 0 ? s : null;
}

/** Narrow an unknown to a plain record so field access is type-safe. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Phone and TCPA consent live on the linked Contact, never on User — one
 * writable copy of every PII field. This block is read-through.
 *
 * PII: this payload is ADMIN-only (canViewUserData / canEditUserData). If
 * either check ever widens beyond ADMIN, phone must be dropped from here.
 */
type PersonContactBlock = {
  phone: string | null;
  phoneConsentAt: Date | null;
  smsMarketingConsentAt: Date | null;
  smsTransactionalConsentAt: Date | null;
  smsOptOutAt: Date | null;
  doNotCall: boolean;
};

const EMPTY_PERSON_CONTACT_BLOCK: PersonContactBlock = {
  phone: null,
  phoneConsentAt: null,
  smsMarketingConsentAt: null,
  smsTransactionalConsentAt: null,
  smsOptOutAt: null,
  doNotCall: false,
};

async function loadPersonContactBlock(userId: string): Promise<PersonContactBlock> {
  const contact = await resolvePersonContact(userId);
  if (!contact) return { ...EMPTY_PERSON_CONTACT_BLOCK };
  return {
    phone: contact.phone,
    phoneConsentAt: contact.phoneConsentAt,
    smsMarketingConsentAt: contact.smsMarketingConsentAt,
    smsTransactionalConsentAt: contact.smsTransactionalConsentAt,
    smsOptOutAt: contact.smsOptOutAt,
    doNotCall: contact.doNotCall,
  };
}

/** Same InvalidPhoneError narrowing api/me/route.ts uses — a cross-realm
 *  instanceof can fail, so the code is checked too. */
function isInvalidPhoneError(error: unknown): boolean {
  return (
    error instanceof InvalidPhoneError ||
    (asRecord(error).code === "INVALID_PHONE")
  );
}

/** Normalize an inbound phone value; a non-string is a caller-fixable 400. */
function phoneForWrite(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new InvalidPhoneError();
  return value.trim() === "" ? null : value;
}

/**
 * Load a user's full editable profile in the exact shape returned by both GET
 * and PATCH. `courseReviews` and `taughtCohortsCount` are read-only context for
 * the admin Proof tab (real reviews to reference while curating testimonials).
 */
async function loadUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      bio: true,
      role: true,
      timezone: true,
      createdAt: true,
      headline: true,
      location: true,
      languages: true,
      socialLinks: true,
      expertiseTags: true,
      isMentor: true,
      profileVisibility: true,
      slug: true,
      portfolioItems: { orderBy: { order: "asc" } },
      profileVideos: { orderBy: { order: "asc" } },
      testimonials: { orderBy: { order: "asc" } },
      reviews: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          rating: true,
          text: true,
          createdAt: true,
          // `Program.name` is the program's title; surfaced as `program.title`
          // so the profile API exposes a stable "program title" field.
          program: { select: { name: true } },
        },
      },
      _count: { select: { taughtCohorts: true } },
    },
  });

  if (!user) return null;

  const { _count, reviews, ...rest } = user;
  return {
    ...rest,
    taughtCohortsCount: _count.taughtCohorts,
    courseReviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt,
      program: { title: r.program.name },
    })),
  };
}

// GET /api/admin/users/[userId]/profile — full editable profile (admin only).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    if (!canViewUserData(await auth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
    const profile = await loadUserProfile(userId);

    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...profile,
      personContact: await loadPersonContactBlock(userId),
    });
  } catch (error) {
    logger.error({ err: error }, "Fetch admin user profile error:");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch user profile: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/users/[userId]/profile — partial profile update (admin only).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    if (!canEditUserData(await auth())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = await params;
    const body = asRecord(await req.json());

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, slug: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const {
      name,
      bio,
      headline,
      location,
      languages,
      socialLinks,
      expertiseTags,
      image,
      timezone,
      isMentor,
      profileVisibility,
      slug,
      portfolioItems,
      profileVideos,
      testimonials,
    } = body;

    // `smsOptOutAt` and `doNotCall` are deliberately NOT read from the body.
    // smsOptOutAt is owned solely by inbound STOP/START, and doNotCall records
    // a human's verbal request — neither may be cleared from an admin UI.
    const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
    const hasCallConsent = Object.prototype.hasOwnProperty.call(body, "callConsent");

    if (hasCallConsent && typeof body.callConsent !== "boolean") {
      return NextResponse.json(
        { error: "Call consent must be true or false" },
        { status: 400 }
      );
    }

    // Validate the visibility enum up-front rather than silently persisting garbage.
    if (
      profileVisibility !== undefined &&
      !PROFILE_VISIBILITIES.includes(profileVisibility as ProfileVisibility)
    ) {
      return NextResponse.json(
        {
          error: `Invalid profileVisibility. Expected one of: ${PROFILE_VISIBILITIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // `sessionTime.ts` hands this string straight to Intl, so an abbreviation like "PST"
    // is accepted here and then silently fails to format at render time. Reject at write.
    if (timezone !== undefined && str(timezone) && !isValidIanaTimezone(str(timezone))) {
      return NextResponse.json(
        {
          error: `Invalid timezone. Expected an IANA identifier, e.g. America/Los_Angeles (got "${str(timezone)}")`,
        },
        { status: 400 }
      );
    }

    // Slug resolution:
    //  - an explicit non-empty slug in the body is always deduped (idempotent for
    //    the user's own current slug, so re-saving an unchanged form is a no-op);
    //  - otherwise, the first time a profile goes PUBLIC without an existing slug,
    //    auto-generate one from the name/email;
    //  - otherwise leave the slug untouched so existing public URLs stay stable.
    let slugData: { slug?: string } = {};
    const providedSlug = slug !== undefined ? str(slug) : "";
    if (providedSlug) {
      slugData = { slug: await uniqueUserSlug(providedSlug, userId) };
    } else if (profileVisibility === "PUBLIC" && !existing.slug) {
      slugData = { slug: await uniqueUserSlug(existing.name || existing.email, userId) };
    }

    // Explicit, per-field partial update — never blind-spread the request body.
    const userData: Prisma.UserUpdateInput = {
      ...(name !== undefined ? { name: strOrNull(name) } : {}),
      ...(bio !== undefined ? { bio: strOrNull(bio) } : {}),
      ...(headline !== undefined ? { headline: strOrNull(headline) } : {}),
      ...(location !== undefined ? { location: strOrNull(location) } : {}),
      ...(languages !== undefined ? { languages: strOrNull(languages) } : {}),
      ...(socialLinks !== undefined ? { socialLinks: strOrNull(socialLinks) } : {}),
      ...(expertiseTags !== undefined ? { expertiseTags: strOrNull(expertiseTags) } : {}),
      ...(image !== undefined ? { image: strOrNull(image) } : {}),
      ...(timezone !== undefined ? { timezone: str(timezone) || "UTC" } : {}),
      ...(isMentor !== undefined ? { isMentor: Boolean(isMentor) } : {}),
      ...(profileVisibility !== undefined ? { profileVisibility: String(profileVisibility) } : {}),
      ...slugData,
    };

    // Full-replace collections. Only the fields present in the body are touched.
    // Fully-empty rows are dropped and `order` is assigned from the surviving index.
    const portfolioRows =
      portfolioItems !== undefined
        ? (Array.isArray(portfolioItems) ? portfolioItems : [])
            .map(asRecord)
            .map((it) => ({
              title: str(it.title),
              url: str(it.url),
              thumbnail: strOrNull(it.thumbnail),
              outcome: strOrNull(it.outcome),
            }))
            .filter((it) => it.title || it.url)
            .map(
              (it, i): Prisma.PortfolioItemCreateManyInput => ({ userId, ...it, order: i })
            )
        : null;

    const videoRows =
      profileVideos !== undefined
        ? (Array.isArray(profileVideos) ? profileVideos : [])
            .map(asRecord)
            .map((it) => ({ title: strOrNull(it.title), url: str(it.url) }))
            .filter((it) => it.url)
            .map(
              (it, i): Prisma.ProfileVideoCreateManyInput => ({ userId, ...it, order: i })
            )
        : null;

    const testimonialRows =
      testimonials !== undefined
        ? (Array.isArray(testimonials) ? testimonials : [])
            .map(asRecord)
            .map((it) => ({
              quote: str(it.quote),
              authorName: str(it.authorName),
              authorRole: strOrNull(it.authorRole),
              authorAvatar: strOrNull(it.authorAvatar),
            }))
            .filter((it) => it.quote || it.authorName)
            .map(
              (it, i): Prisma.TestimonialCreateManyInput => ({
                userId,
                ...it,
                source: "manual",
                order: i,
              })
            )
        : null;

    await prisma.$transaction(async (tx) => {
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userData });
      }
      if (portfolioRows !== null) {
        await tx.portfolioItem.deleteMany({ where: { userId } });
        if (portfolioRows.length) {
          await tx.portfolioItem.createMany({ data: portfolioRows });
        }
      }
      if (videoRows !== null) {
        await tx.profileVideo.deleteMany({ where: { userId } });
        if (videoRows.length) {
          await tx.profileVideo.createMany({ data: videoRows });
        }
      }
      if (testimonialRows !== null) {
        await tx.testimonial.deleteMany({ where: { userId } });
        if (testimonialRows.length) {
          await tx.testimonial.createMany({ data: testimonialRows });
        }
      }
    });

    if (hasPhone || hasCallConsent) {
      // Read the current state only when the request supplies one half of the
      // pair, so an unrelated edit cannot silently flip the other half.
      const current =
        hasPhone && hasCallConsent ? null : await resolvePersonContact(userId);
      await setPersonPhone({
        userId,
        phone: hasPhone ? phoneForWrite(body.phone) : current?.phone ?? null,
        smsMarketingConsent: false,
        smsTransactionalConsent: false,
        callConsent: hasCallConsent
          ? (body.callConsent as boolean)
          : (current?.phoneConsentAt ?? null) !== null,
        actor: "admin",
      });
    }

    const profile = await loadUserProfile(userId);
    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...profile,
      personContact: await loadPersonContactBlock(userId),
    });
  } catch (error) {
    if (isInvalidPhoneError(error)) {
      return NextResponse.json(
        { error: "Enter a valid phone number." },
        { status: 400 }
      );
    }

    logger.error({ err: error }, "Update admin user profile error:");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to update user profile: ${errorMessage}` },
      { status: 500 }
    );
  }
}
