import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/roles";
import {
  boundedParam,
  MCP_DETAIL_MAX_BYTES,
  MCP_LIST_MAX_BYTES,
  mcpError,
  mcpJson,
  mcpJsonLimited,
  parseJsonObject,
  parseMcpPagination,
  requireMcpToken,
} from "@/lib/mcpApi";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);
const MAX_INSTRUCTOR_CANDIDATES = 1000;

type SocialLinks = Record<string, unknown>;

function parseBooleanParam(url: URL, name: string): boolean | undefined | "invalid" {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return "invalid";
}

function readSocialLinks(value: string | null): SocialLinks {
  return parseJsonObject(value) ?? {};
}

function getLinkedinUrl(socialLinks: SocialLinks): string | null {
  const linkedin = socialLinks.linkedin;
  if (typeof linkedin !== "string" || !linkedin) return null;

  try {
    const url = new URL(linkedin);
    if (
      url.protocol === "https:" &&
      LINKEDIN_HOSTS.has(url.hostname) &&
      url.pathname.startsWith("/in/")
    ) {
      return url.toString();
    }
  } catch (error) {
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }

  return null;
}

function summarizeSocialLinks(value: string | null) {
  const socialLinks = readSocialLinks(value);
  return {
    socialLinks,
    linkedinUrl: getLinkedinUrl(socialLinks),
  };
}

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = boundedParam(url, "id", 128);
  const slug = boundedParam(url, "slug", 200);
  if (id && slug) return mcpError("Provide id or slug, not both", 400);

  try {
    if (id || slug) {
      const instructor = await prisma.user.findFirst({
        where: id ? { id } : { slug },
        select: {
          id: true,
          name: true,
          email: true,
          slug: true,
          headline: true,
          bio: true,
          image: true,
          location: true,
          languages: true,
          expertiseTags: true,
          socialLinks: true,
          timezone: true,
          isMentor: true,
          profileVisibility: true,
          createdAt: true,
          updatedAt: true,
          role: true,
          roles: true,
          taughtCohorts: {
            orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
            },
          },
          _count: { select: { taughtCohorts: true } },
        },
      });

      if (!instructor || !hasRole(instructor, "INSTRUCTOR")) {
        return mcpError("Instructor not found", 404);
      }

      const { socialLinks, linkedinUrl } = summarizeSocialLinks(instructor.socialLinks);
      const { _count, role: _legacyRole, roles: _rolesJson, image, ...item } = instructor;
      // Keep detail responses under MCP_DETAIL_MAX_BYTES even with base64 avatars.
      const imageTooLarge = typeof image === "string" && image.startsWith("data:") && image.length > 100_000;
      return mcpJsonLimited(
        {
          item: {
            ...item,
            image: imageTooLarge ? null : image,
            hasImage: Boolean(image),
            socialLinks,
            linkedinUrl,
            taughtCohortCount: _count.taughtCohorts,
          },
        },
        MCP_DETAIL_MAX_BYTES
      );
    }

    const { page, pageSize, skip } = parseMcpPagination(url);
    const q = boundedParam(url, "q", 200);
    const roleFilter = boundedParam(url, "role", 32) ?? "INSTRUCTOR";
    const hasProfile = parseBooleanParam(url, "hasProfile");
    if (hasProfile === "invalid") {
      return mcpError("hasProfile must be true or false", 400);
    }

    const whereClauses = [
      ...(q ? [{ name: { contains: q } }] : []),
      ...(hasProfile === undefined
        ? []
        : hasProfile
          ? [{ OR: [{ headline: { not: null } }, { bio: { not: null } }] }]
          : [{ headline: null, bio: null }]),
      { OR: [{ role: roleFilter }, { roles: { contains: roleFilter } }] },
    ];
    const where = whereClauses.length === 1 ? whereClauses[0] : { AND: whereClauses };

    // SQLite-backed Prisma cannot express "roles JSON array contains X" accurately,
    // so we overfetch the rough candidate set, post-filter via hasRole(), and paginate
    // after filtering. The candidate cap prevents an unbounded scan; when it is hit
    // we surface candidatesTruncated so callers know total is only for the capped set.
    const candidates = await prisma.user.findMany({
      where,
      take: MAX_INSTRUCTOR_CANDIDATES,
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        headline: true,
        image: true,
        location: true,
        expertiseTags: true,
        profileVisibility: true,
        socialLinks: true,
        role: true,
        roles: true,
        _count: { select: { taughtCohorts: true } },
      },
    });

    const candidatesTruncated = candidates.length === MAX_INSTRUCTOR_CANDIDATES;
    const filtered = candidates.filter((candidate) => hasRole(candidate, roleFilter));
    const total = filtered.length;
    const items = filtered.slice(skip, skip + pageSize).map((candidate) => {
      const { linkedinUrl } = summarizeSocialLinks(candidate.socialLinks);
      const {
        _count,
        role: _legacyRole,
        roles: _rolesJson,
        socialLinks: _rawSocialLinks,
        image,
        ...item
      } = candidate;
      // Uploaded avatars can be stored as base64 data-URLs; a single one is enough
      // to push the whole list response past MCP_LIST_MAX_BYTES (the prod 413 at
      // pageSize=1). Lists expose only URL images + a hasImage flag; the raw value
      // stays available via the detail endpoint's larger budget.
      const isDataUrl = typeof image === "string" && image.startsWith("data:");
      return {
        ...item,
        image: isDataUrl ? null : image,
        hasImage: Boolean(image),
        linkedinUrl,
        taughtCohortCount: _count.taughtCohorts,
      };
    });

    return mcpJsonLimited(
      {
        items,
        page,
        pageSize,
        total,
        hasMore: skip + items.length < total,
        ...(candidatesTruncated ? { candidatesTruncated: true } : {}),
      },
      MCP_LIST_MAX_BYTES
    );
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] instructor query failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Instructor query failed", correlationId }, 500);
  }
}
