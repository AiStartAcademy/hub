import { brand } from "@/config/brand";
import { mcpJson, MCP_API_VERSION, requireMcpToken, mcpWritesEnabled } from "@/lib/mcpApi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  return mcpJson({
    service: brand.ids.serviceId,
    apiVersion: MCP_API_VERSION,
    environment: process.env.HUB_ENV ?? process.env.NODE_ENV ?? "unknown",
    writesEnabled: await mcpWritesEnabled(),
  });
}
