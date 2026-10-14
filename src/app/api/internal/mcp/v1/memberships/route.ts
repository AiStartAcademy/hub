// src/app/api/internal/mcp/v1/memberships/route.ts
//
// MCP surface for complimentary memberships. Delegates to
// src/lib/membershipAdmin.ts, which enforces the comp-only guard — the Stripe
// webhook remains the sole writer of paid membership state.
//
//   GET    ?tier=&status=&compOnly=&page=&pageSize=   — list memberships
//   POST   { email, tier, months? }                   — grant a comp membership
//   DELETE { membershipId }                           — revoke a comp membership

import { NextResponse } from "next/server";
import {
  requireMcpToken,
  mcpWritesEnabled,
  mcpError,
  mcpJsonLimited,
  parseMcpPagination,
  MCP_LIST_MAX_BYTES,
} from "@/lib/mcpApi";
import {
  grantCompMembership,
  revokeComp,
  listMemberships,
  MEMBERSHIP_TIERS_VALID,
  type CompTier,
} from "@/lib/membershipAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const { page, pageSize } = parseMcpPagination(url);
  const tier = url.searchParams.get("tier") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const compOnly = url.searchParams.get("compOnly") === "true";

  if (tier && !(MEMBERSHIP_TIERS_VALID as readonly string[]).includes(tier)) {
    return mcpError(`tier must be one of: ${MEMBERSHIP_TIERS_VALID.join(", ")}`, 400);
  }

  const result = await listMemberships({ tier, status, compOnly, page, pageSize });
  return mcpJsonLimited(result, MCP_LIST_MAX_BYTES);
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;
  if (!(await mcpWritesEnabled())) {
    return mcpError("MCP writes are disabled (HUB_MCP_WRITES_ENABLED)", 403);
  }

  let body: { email?: unknown; tier?: unknown; months?: unknown };
  try {
    body = await req.json();
  } catch {
    return mcpError("Invalid JSON body", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const tier = typeof body.tier === "string" ? body.tier : "";
  const months = typeof body.months === "number" ? body.months : 0;

  if (!email) return mcpError("email is required", 400);
  if (!(MEMBERSHIP_TIERS_VALID as readonly string[]).includes(tier)) {
    return mcpError(`tier must be one of: ${MEMBERSHIP_TIERS_VALID.join(", ")}`, 400);
  }
  if (!Number.isInteger(months) || months < 0 || months > 24) {
    return mcpError("months must be an integer 0-24 (0 = open-ended)", 400);
  }

  try {
    const { membership, user, userCreated } = await grantCompMembership({
      email,
      tier: tier as CompTier,
      months,
      grantedBy: "mcp",
    });
    return NextResponse.json(
      {
        membershipId: membership.id,
        tier: membership.tier,
        status: membership.status,
        currentPeriodEnd: membership.currentPeriodEnd,
        email: user.email,
        userCreated,
      },
      { status: 201 }
    );
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : "Grant failed", 400);
  }
}

export async function DELETE(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;
  if (!(await mcpWritesEnabled())) {
    return mcpError("MCP writes are disabled (HUB_MCP_WRITES_ENABLED)", 403);
  }

  let body: { membershipId?: unknown };
  try {
    body = await req.json();
  } catch {
    return mcpError("Invalid JSON body", 400);
  }
  const membershipId =
    typeof body.membershipId === "string" ? body.membershipId : "";
  if (!membershipId) return mcpError("membershipId is required", 400);

  try {
    const revoked = await revokeComp(membershipId);
    return NextResponse.json(revoked);
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : "Revoke failed", 400);
  }
}
