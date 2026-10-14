import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireManagedServiceToken } from "@/lib/serviceAuth";
import { getSecret } from "@/lib/secrets";

export const MCP_API_VERSION = "v1";
export const MCP_DEFAULT_PAGE_SIZE = 25;
export const MCP_MAX_PAGE_SIZE = 100;
export const MCP_LIST_MAX_BYTES = 64 * 1024;
export const MCP_DETAIL_MAX_BYTES = 256 * 1024;

const SAFE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function requireMcpToken(req: Request): Promise<NextResponse | null> {
  const denied = await requireManagedServiceToken(req, "HUB_MCP_TOKEN");
  if (!denied) return null;
  for (const [name, value] of Object.entries(SAFE_HEADERS)) {
    denied.headers.set(name, value);
  }
  return denied;
}

/**
 * Server-side MCP write kill switch, resolved through the Integrations store
 * (DB-managed HUB_MCP_WRITES_ENABLED → env fallback). Writes are enabled only
 * when the value is exactly "true".
 */
export async function mcpWritesEnabled(): Promise<boolean> {
  return (await getSecret("HUB_MCP_WRITES_ENABLED")) === "true";
}

export function mcpJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: SAFE_HEADERS });
}

export function mcpError(message: string, status: number): NextResponse {
  return mcpJson({ error: message, correlationId: randomUUID() }, status);
}

export function mcpJsonLimited(data: unknown, maxBytes: number): NextResponse {
  const serialized = JSON.stringify(data);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > maxBytes) {
    return mcpJson(
      {
        error: "Response exceeds the MCP safety limit; narrow the query or use a smaller pageSize",
        correlationId: randomUUID(),
        maxBytes,
      },
      413
    );
  }
  return new NextResponse(serialized, {
    status: 200,
    headers: { ...SAFE_HEADERS, "Content-Type": "application/json" },
  });
}

export interface McpPagination {
  page: number;
  pageSize: number;
  skip: number;
}

export function parseMcpPagination(url: URL): McpPagination {
  const rawPage = Number(url.searchParams.get("page") ?? 1);
  const rawPageSize = Number(
    url.searchParams.get("pageSize") ?? MCP_DEFAULT_PAGE_SIZE
  );
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const requestedSize =
    Number.isSafeInteger(rawPageSize) && rawPageSize > 0
      ? rawPageSize
      : MCP_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requestedSize, MCP_MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function boundedParam(
  url: URL,
  name: string,
  maxLength: number
): string | undefined {
  const raw = url.searchParams.get(name)?.trim();
  if (!raw) return undefined;
  return raw.slice(0, maxLength);
}

export function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
