import prisma from "@/lib/prisma";
import {
  MCP_LIST_MAX_BYTES,
  mcpError,
  mcpJsonLimited,
  mcpWritesEnabled,
  requireMcpToken,
} from "@/lib/mcpApi";
import { changeLeadStatus } from "@/lib/leads/status";
import {
  executeLeadUpdateBatch,
  parseLeadUpdateBatch,
} from "@/lib/leads/update";

export const dynamic = "force-dynamic";

/**
 * PATCH is deliberate: every requested item partially updates an existing
 * contact, and this endpoint never creates contacts or replaces full records.
 */
export async function PATCH(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;
  if (!(await mcpWritesEnabled())) {
    return mcpError("MCP writes are disabled (HUB_MCP_WRITES_ENABLED)", 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mcpError("Invalid JSON body", 400);
  }

  const parsed = parseLeadUpdateBatch(body);
  if (!parsed.ok) return mcpError(parsed.error, 400);

  const results = await executeLeadUpdateBatch(parsed.updates, {
    loadContact: (id) =>
      prisma.contact.findUnique({
        where: { id },
        select: { tags: true },
      }),
    changeStatus: (id, status, expectedCurrentStatus) =>
      changeLeadStatus(
        id,
        status,
        { id: null, label: "mcp" },
        expectedCurrentStatus
      ),
    updateFields: (id, fields) =>
      prisma.contact.update({ where: { id }, data: fields }),
  });

  const succeeded = results.filter((result) => result.ok).length;
  return mcpJsonLimited(
    {
      results,
      summary: {
        requested: results.length,
        succeeded,
        failed: results.length - succeeded,
      },
    },
    MCP_LIST_MAX_BYTES
  );
}
