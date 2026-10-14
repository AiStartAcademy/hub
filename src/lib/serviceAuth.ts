// src/lib/serviceAuth.ts
// Bearer-token auth for machine-to-machine routes (agents service, site build,
// content ingest). Distinct from NextAuth session auth used by admin UI routes.
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";

function tokenMatches(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Returns null if the request carries the expected bearer token for `envName`,
 * or a 401/500 NextResponse to return directly if not.
 *
 *   const denied = requireServiceToken(req, "CONTENT_INGEST_TOKEN");
 *   if (denied) return denied;
 */
function checkBearer(req: Request, expected: string | undefined, name: string): NextResponse | null {
  if (!expected) {
    // Fail closed: a missing server token is a misconfiguration, not open access.
    logger.error(`[serviceAuth] ${name} is not set — refusing request`);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !tokenMatches(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function requireServiceToken(
  req: Request,
  envName: string
): NextResponse | null {
  return checkBearer(req, process.env[envName], envName);
}

/**
 * Like requireServiceToken, but resolves the expected token through getSecret()
 * (DB-managed Integrations value → env fallback). Async so it can read the store.
 * Use for tokens that admins rotate from the Integrations tab (e.g. HUB_MCP_TOKEN).
 */
export async function requireManagedServiceToken(
  req: Request,
  key: string
): Promise<NextResponse | null> {
  const { getSecret } = await import("@/lib/secrets");
  return checkBearer(req, await getSecret(key), key);
}
