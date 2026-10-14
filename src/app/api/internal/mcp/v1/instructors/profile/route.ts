import prisma from "@/lib/prisma";
import {
  mcpError,
  mcpJson,
  mcpWritesEnabled,
  parseJsonObject,
  requireMcpToken,
} from "@/lib/mcpApi";
import { sanitizeDescription } from "@/lib/sanitize";
import { isProfileVisibility, PROFILE_VISIBILITIES } from "@/lib/profileVisibility";
import { isValidIanaTimezone } from "@/lib/timezone";
import { uniqueUserSlug } from "@/lib/slug";
import { resolvePublicSlugIntent } from "@/lib/publicSlugIntent";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const WRITES_DISABLED_MESSAGE =
  "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true').";

const TARGET_KEYS = ["userId", "email", "slug"] as const;
const PROFILE_KEYS = [
  "headline",
  "bio",
  "location",
  "languages",
  "expertiseTags",
  "linkedinUrl",
  "image",
  "timezone",
  "profileVisibility",
  // The public /humans/{slug} handle. Deliberately NOT named `slug`: that key is
  // already taken as a lookup target above, and one key meaning both "who to edit"
  // and "what to rename them to" is exactly the ambiguity that gets a wrong row written.
  "publicSlug",
] as const;
const ALLOWED_KEYS = new Set<string>([...TARGET_KEYS, ...PROFILE_KEYS]);
const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);
/**
 * Columns with a NOT NULL default — clearing them to null would violate the schema.
 * `publicSlug` is deliberately absent: `User.slug` is `String?`, so null is a legal
 * value meaning "no public handle", and refusing it would make handles un-clearable.
 */
const NON_NULLABLE_KEYS = new Set<ProfileKey>(["timezone", "profileVisibility"]);

type TargetKey = (typeof TARGET_KEYS)[number];
type ProfileKey = (typeof PROFILE_KEYS)[number];
type SocialLinks = Record<string, unknown>;
type PatchBody = Partial<Record<TargetKey | ProfileKey, unknown>>;
type ValidatedUpdates = Partial<
  Record<Exclude<ProfileKey, "linkedinUrl">, string | null> & { linkedinUrl: string | null }
>;
type ChangedField = { from: string | null; to: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStoredText(value: string | null): string | null {
  if (value === null) return null;
  if (value === "") return "";
  return sanitizeDescription(value);
}

function parseHttpsUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Error(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${field} must use https`);
  }
  return parsed.toString();
}

function parseLinkedinUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Error("linkedinUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("linkedinUrl must use https");
  }
  if (!LINKEDIN_HOSTS.has(parsed.hostname)) {
    throw new Error("linkedinUrl must use linkedin.com or www.linkedin.com");
  }
  if (!parsed.pathname.startsWith("/in/")) {
    throw new Error("linkedinUrl must start with /in/");
  }
  return parsed.toString();
}

function readSocialLinks(value: string | null): SocialLinks {
  return parseJsonObject(value) ?? {};
}

function getStoredLinkedinUrl(socialLinks: SocialLinks): string | null {
  const linkedin = socialLinks.linkedin;
  return typeof linkedin === "string" ? linkedin : null;
}

function validateLength(value: string, field: ProfileKey, maxLength: number) {
  if (value.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters`);
  }
}

function validateUpdates(body: PatchBody): ValidatedUpdates {
  const updates: ValidatedUpdates = {};

  for (const key of PROFILE_KEYS) {
    if (!(key in body)) continue;
    const rawValue = body[key];
    if (rawValue === null) {
      if (NON_NULLABLE_KEYS.has(key)) {
        throw new Error(`${key} cannot be null`);
      }
      updates[key] = null;
      continue;
    }
    if (typeof rawValue !== "string") {
      throw new Error(`${key} must be a string or null`);
    }

    if (key === "bio") {
      validateLength(rawValue, "bio", 20000);
      updates.bio = sanitizeStoredText(rawValue);
      continue;
    }
    if (key === "headline") {
      validateLength(rawValue, "headline", 200);
      // Stored raw, matching the admin profile route. `headline` is plain text —
      // running it through the HTML sanitizer entity-escaped every "&" into "&amp;",
      // which then rendered literally because nothing interprets this field as HTML.
      updates.headline = rawValue;
      continue;
    }
    if (key === "timezone") {
      const trimmed = rawValue.trim();
      if (!isValidIanaTimezone(trimmed)) {
        throw new Error(
          `timezone must be a valid IANA identifier, e.g. America/Los_Angeles (got "${trimmed}")`
        );
      }
      updates.timezone = trimmed;
      continue;
    }
    if (key === "profileVisibility") {
      const trimmed = rawValue.trim().toUpperCase();
      if (!isProfileVisibility(trimmed)) {
        throw new Error(
          `profileVisibility must be one of: ${PROFILE_VISIBILITIES.join(", ")}`
        );
      }
      updates.profileVisibility = trimmed;
      continue;
    }
    if (key === "publicSlug") {
      const trimmed = rawValue.trim();
      validateLength(trimmed, "publicSlug", 80);
      // Emptiness and URL-safety are judged by resolvePublicSlugIntent, which also has to
      // reason about visibility; duplicating the checks here would let them drift apart.
      updates.publicSlug = trimmed;
      continue;
    }
    if (key === "location") {
      validateLength(rawValue, "location", 500);
      updates.location = rawValue;
      continue;
    }
    if (key === "languages") {
      validateLength(rawValue, "languages", 500);
      updates.languages = rawValue;
      continue;
    }
    if (key === "expertiseTags") {
      validateLength(rawValue, "expertiseTags", 500);
      updates.expertiseTags = rawValue;
      continue;
    }
    if (key === "image") {
      updates.image = parseHttpsUrl(rawValue, "image");
      continue;
    }
    if (key === "linkedinUrl") {
      updates.linkedinUrl = rawValue === "" ? null : parseLinkedinUrl(rawValue);
    }
  }

  return updates;
}

export async function PATCH(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpJson({ error: WRITES_DISABLED_MESSAGE }, 403);
  }

  let body: PatchBody;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) {
      return mcpError("Expected a JSON object body", 400);
    }
    body = parsed;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mcpError("Invalid JSON", 400);
  }

  const targetEntries = TARGET_KEYS.filter((key) => {
    const value = body[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  if (targetEntries.length !== 1) {
    return mcpError("Provide exactly one of userId, email, or slug", 400);
  }

  try {
    const targetKey = targetEntries[0];
    const targetValue = (body[targetKey] as string).trim();
    // Prisma's UserWhereUniqueInput needs one of its own discriminated shapes, not a
    // dynamically-keyed object — "userId" (the API's public name) maps to the User model's `id`.
    const where =
      targetKey === "userId"
        ? { id: targetValue }
        : targetKey === "email"
          ? { email: targetValue }
          : { slug: targetValue };
    const instructor = await prisma.user.findUnique({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        headline: true,
        bio: true,
        location: true,
        languages: true,
        expertiseTags: true,
        image: true,
        socialLinks: true,
        timezone: true,
        profileVisibility: true,
        slug: true,
      },
    });
    if (!instructor) {
      return mcpError("Instructor not found", 404);
    }

    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        return mcpError(`Rejected key: ${key}`, 400);
      }
    }

    let updates: ValidatedUpdates;
    try {
      updates = validateUpdates(body);
    } catch (error) {
      return mcpError((error as Error).message, 400);
    }

    const currentSocialLinks = readSocialLinks(instructor.socialLinks);
    const currentValues: Record<ProfileKey, string | null> = {
      headline: instructor.headline,
      bio: instructor.bio,
      location: instructor.location,
      languages: instructor.languages,
      expertiseTags: instructor.expertiseTags,
      linkedinUrl: getStoredLinkedinUrl(currentSocialLinks),
      image: instructor.image,
      timezone: instructor.timezone,
      profileVisibility: instructor.profileVisibility,
      publicSlug: instructor.slug,
    };

    const changed: Partial<Record<ProfileKey, ChangedField>> = {};
    const unchanged: ProfileKey[] = [];
    const data: Record<string, string | null> = {};

    // Handle resolution. The decision is a pure function so it can be tested without a
    // DB (see lib/publicSlugIntent.ts); only the uniqueness round-trip happens here.
    const slugIntent = resolvePublicSlugIntent({
      publicSlugProvided: "publicSlug" in body,
      publicSlug: updates.publicSlug ?? null,
      requestedVisibility: updates.profileVisibility ?? null,
      storedVisibility: instructor.profileVisibility,
      currentSlug: instructor.slug,
      name: instructor.name,
      email: instructor.email,
    });
    if (slugIntent.action === "refuse") {
      return mcpError(slugIntent.reason, 400);
    }
    // `undefined` means "don't touch the column" — distinct from `null`, which clears it.
    const resolvedSlug: string | null | undefined =
      slugIntent.action === "leave"
        ? undefined
        : slugIntent.action === "clear"
          ? null
          : await uniqueUserSlug(slugIntent.base, instructor.id);
    if (resolvedSlug !== undefined) {
      if (resolvedSlug === instructor.slug) {
        unchanged.push("publicSlug");
      } else {
        changed.publicSlug = { from: instructor.slug, to: resolvedSlug };
        data.slug = resolvedSlug;
      }
    }

    for (const key of PROFILE_KEYS) {
      if (!(key in body)) continue;

      // Already resolved above — it needs the visibility decision and a DB round-trip.
      if (key === "publicSlug") continue;

      if (key === "linkedinUrl") {
        const nextLinkedin = updates.linkedinUrl ?? null;
        const mergedSocialLinks = { ...currentSocialLinks };
        if (nextLinkedin === null) {
          delete mergedSocialLinks.linkedin;
        } else {
          mergedSocialLinks.linkedin = nextLinkedin;
        }
        const nextSocialLinks = JSON.stringify(mergedSocialLinks);
        if (currentValues.linkedinUrl === nextLinkedin) {
          unchanged.push("linkedinUrl");
        } else {
          changed.linkedinUrl = { from: currentValues.linkedinUrl, to: nextLinkedin };
          data.socialLinks = nextSocialLinks;
        }
        continue;
      }

      const nextValue = updates[key] ?? null;
      if (currentValues[key] === nextValue) {
        unchanged.push(key);
      } else {
        changed[key] = { from: currentValues[key], to: nextValue };
        data[key] = nextValue;
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.user.update({
        where: { id: instructor.id },
        data,
      });
    }

    // TODO(003): replace this temporary MCP audit log with the real audit writer.
    console.info("[mcp-audit] instructor_profile_update", {
      actor: "mcp",
      targetUserId: instructor.id,
      changedKeys: Object.keys(changed),
    });

    return mcpJson({
      userId: instructor.id,
      changed,
      unchanged,
    });
  } catch (error) {
    // uniqueUserSlug checks for a clash and then we write, so two concurrent writers can
    // both pass the check and one loses on the unique index. Nothing bad is stored, but
    // say so plainly instead of returning an opaque 500 the caller can't act on.
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "P2002"
    ) {
      return mcpError("publicSlug was taken concurrently — retry with a different handle", 409);
    }
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] instructor profile update failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Instructor profile update failed", correlationId }, 500);
  }
}
