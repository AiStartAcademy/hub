import { logger } from "@/lib/logger";
import { resolveSmsableByEmail } from "@/lib/leads/personRecord";
import {
  MCP_LIST_MAX_BYTES,
  mcpError,
  mcpJson,
  mcpJsonLimited,
  requireMcpToken,
} from "@/lib/mcpApi";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PII WARNING: This route deliberately returns attendee names and emails.
 * It is the one MCP read surface that exposes PII so an operator can assemble
 * a broadcast audience. It is safe only because requireMcpToken gates it;
 * anyone widening this route's authorization must revisit that decision.
 *
 * It deliberately does NOT return the phone number. This tool is reachable by
 * a production agent, and the roster's job is "can I text them", not the
 * digits — so messageability is exposed as the `smsable` boolean only.
 * Broadcasts read the number server-side, where they already do.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMcpToken(req); if (denied) return denied;

  const { id } = await params;

  try {
    const cohort = await prisma.cohort.findFirst({
      where: { OR: [{ id }, { slug: id }] },
      select: {
        id: true,
        slug: true,
        title: true,
        enrollments: {
          where: { status: { not: "dropped" } },
          select: {
            source: true,
            user: { select: { name: true, email: true } },
          },
        },
        groups: {
          select: {
            name: true,
            members: {
              select: { user: { select: { name: true, email: true } } },
            },
          },
        },
      },
    });

    if (!cohort) return mcpError("Cohort not found", 404);

    type EnrollmentSource = "native" | "luma" | "manual" | "stripe";
    type RosterRow = {
      name: string | null;
      email: string;
      tier: string | null;
      source: EnrollmentSource | "group";
      smsable: boolean;
    };

    const rosterByEmail = new Map<string, RosterRow>();
    for (const enrollment of cohort.enrollments) {
      rosterByEmail.set(enrollment.user.email.toLowerCase(), {
        name: enrollment.user.name,
        email: enrollment.user.email,
        tier: null,
        source: enrollment.source as EnrollmentSource,
        // Filled in from one batched Contact query once the roster is merged.
        smsable: false,
      });
    }

    for (const group of cohort.groups) {
      for (const member of group.members) {
        const key = member.user.email.toLowerCase();
        const existing = rosterByEmail.get(key);
        if (existing) {
          // Enrollment remains authoritative for source; group membership can
          // still supply the tier that Enrollment does not directly relate to.
          existing.tier ??= group.name;
        } else {
          rosterByEmail.set(key, {
            name: member.user.name,
            email: member.user.email,
            tier: group.name,
            source: "group",
            smsable: false,
          });
        }
      }
    }

    // One batched Contact query for the whole roster — booleans only, so a
    // number cannot leak through this surface even by accident.
    const smsableByEmail = await resolveSmsableByEmail([...rosterByEmail.keys()]);
    for (const [email, row] of rosterByEmail) {
      row.smsable = smsableByEmail.get(email) ?? false;
    }

    const roster = [...rosterByEmail.values()];
    return mcpJsonLimited(
      { cohort: { id: cohort.id, slug: cohort.slug, title: cohort.title }, roster, total: roster.length },
      MCP_LIST_MAX_BYTES
    );
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] cohort roster failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Cohort roster failed", correlationId }, 500);
  }
}
