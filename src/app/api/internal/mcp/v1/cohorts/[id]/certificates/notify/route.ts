import { enrollCertificateNotifications } from "@/lib/drip/certificateNotify";
import { logger } from "@/lib/logger";
import {
  mcpError,
  mcpJson,
  mcpWritesEnabled,
  requireMcpToken,
} from "@/lib/mcpApi";

export const dynamic = "force-dynamic";

type NotifyBody = {
  certificateIds?: string[];
  dryRun?: boolean;
};

function isNotifyBody(value: unknown): value is NotifyBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const body = value as Record<string, unknown>;
  return (
    (body.certificateIds === undefined ||
      (Array.isArray(body.certificateIds) &&
        body.certificateIds.every((id): id is string => typeof id === "string"))) &&
    (body.dryRun === undefined || typeof body.dryRun === "boolean")
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMcpToken(req); if (denied) return denied;
  if (!(await mcpWritesEnabled())) return mcpError("MCP writes are disabled", 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch (error: unknown) {
    const correlationId = crypto.randomUUID();
    logger.warn(
      `[mcp:${correlationId}] invalid certificate notify JSON (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpError("Invalid request body", 400);
  }

  if (!isNotifyBody(body)) return mcpError("Invalid request body", 400);

  const { id } = await params;
  try {
    const result = await enrollCertificateNotifications(id, {
      certificateIds: body.certificateIds,
      dryRun: body.dryRun,
    });
    return mcpJson(result);
  } catch (error: unknown) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] certificate notification enrollment failed for cohort ${id} (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Certificate notification enrollment failed", correlationId }, 500);
  }
}
