import { mcpError, mcpJson, requireMcpToken } from "@/lib/mcpApi";
import { countSegmentMatches } from "@/lib/drip/engine";
import { parseSegment } from "@/lib/drip/segment";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) return mcpError("Expected a JSON object body", 400);
    body = parsed;
  } catch {
    return mcpError("Invalid JSON", 400);
  }

  if (!("segment" in body) || !isRecord(body.segment)) {
    return mcpError("segment must be an object", 400);
  }

  try {
    const count = await countSegmentMatches(parseSegment(JSON.stringify(body.segment)));
    return mcpJson({ count });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] drip audience preview failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Audience preview failed", correlationId }, 500);
  }
}
