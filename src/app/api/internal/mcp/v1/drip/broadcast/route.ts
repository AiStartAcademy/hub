import { sendBroadcast } from "@/lib/drip/broadcast";
import { logger } from "@/lib/logger";
import {
  mcpError,
  mcpJson,
  mcpWritesEnabled,
  requireMcpToken,
} from "@/lib/mcpApi";

export const dynamic = "force-dynamic";

type BroadcastRequestBody = {
  campaignId: string;
  dryRun?: boolean;
  sendAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req); if (denied) return denied;
  if (!(await mcpWritesEnabled())) return mcpError("MCP writes are disabled", 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    return mcpError(
      `Invalid JSON body${error instanceof Error ? `: ${error.message}` : ""}`,
      400
    );
  }

  if (
    !isRecord(body) ||
    typeof body.campaignId !== "string" ||
    body.campaignId.length === 0
  ) {
    return mcpError("campaignId must be a non-empty string", 400);
  }

  let sendAt: Date | undefined;
  if (body.sendAt !== undefined) {
    if (typeof body.sendAt !== "string") {
      return mcpError("sendAt must be a valid date", 400);
    }
    sendAt = new Date(body.sendAt);
    if (Number.isNaN(sendAt.getTime())) {
      return mcpError("sendAt must be a valid date", 400);
    }
  }

  const requestBody: BroadcastRequestBody = {
    campaignId: body.campaignId,
    ...(typeof body.dryRun === "boolean" ? { dryRun: body.dryRun } : {}),
    ...(typeof body.sendAt === "string" ? { sendAt: body.sendAt } : {}),
  };

  try {
    const result = await sendBroadcast(requestBody.campaignId, {
      dryRun: requestBody.dryRun,
      sendAt,
    });

    if (!result.ok) return mcpError(result.reason, 409);

    return mcpJson({
      campaignId: requestBody.campaignId,
      sent: result.enrolled,
      failed: 0,
      counts: result.counts,
    });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error(
      `[mcp:${correlationId}] broadcast send failed (${error instanceof Error ? error.name : "unknown"})`
    );
    return mcpJson({ error: "Broadcast send failed", correlationId }, 500);
  }
}
