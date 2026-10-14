/**
 * MCP-authenticated course cover generation. Mirrors the admin UI's
 * /api/generate-image route exactly (same model, same GCS destination
 * convention) so agent-generated covers are visually consistent with every
 * existing course — this is not a separate visual pipeline.
 *
 * Returns the GCS URL only; it does NOT write Program.cover. Review the
 * image, then call PATCH /v1/programs with { id, cover } to attach it.
 */
import { uploadToGCS } from "@/lib/gcs";
import { logger } from "@/lib/logger";
import { mcpError, mcpJson, mcpWritesEnabled, requireMcpToken } from "@/lib/mcpApi";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const WRITES_DISABLED_MESSAGE =
  "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true'). Blocked here too: this call spends real money on a live OpenAI image generation request and writes a file to GCS, even though it never touches the database.";

interface CoverGenerateBody {
  prompt?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpJson({ error: WRITES_DISABLED_MESSAGE }, 403);
  }

  let body: CoverGenerateBody;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) return mcpError("Expected a JSON object body", 400);
    body = parsed;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mcpError("Invalid JSON", 400);
  }

  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    return mcpError("prompt is required", 400);
  }
  if (body.prompt.length > 4000) {
    return mcpError("prompt too long (max 4000 chars)", 400);
  }

  // Resolved through the Integrations store (DB-managed → env fallback), NOT bare
  // process.env — OPENAI_API_KEY is managed at /admin/integrations, so reading env
  // directly would ignore a key that is correctly configured there.
  const apiKey = await getSecret("OPENAI_API_KEY");
  if (!apiKey) {
    return mcpJson(
      { error: "OPENAI_API_KEY is not configured — set it at /admin/integrations (or as an env fallback)." },
      500
    );
  }

  let dalleResponse: Response;
  try {
    dalleResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1.5",
        prompt: body.prompt,
        n: 1,
        size: "1536x1024",
      }),
    });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logger.error({ err: error }, `[mcp:${correlationId}] cover-generate fetch failed`);
    return mcpJson({ error: "Could not reach the image generation service", correlationId }, 502);
  }

  if (!dalleResponse.ok) {
    let message = "Unknown error";
    try {
      const errBody = (await dalleResponse.json()) as { error?: { message?: string } };
      message = errBody.error?.message ?? message;
    } catch {
      // ignore parse failure, use default message
    }
    return mcpJson({ error: `OpenAI error: ${message}` }, dalleResponse.status);
  }

  const data = (await dalleResponse.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };
  const imageData = data.data?.[0];

  let imageBuffer: Buffer | null = null;
  if (imageData?.url) {
    const imageResponse = await fetch(imageData.url);
    if (!imageResponse.ok) {
      return mcpJson({ error: "Failed to download generated image" }, 500);
    }
    imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  } else if (imageData?.b64_json) {
    imageBuffer = Buffer.from(imageData.b64_json, "base64");
  }

  if (!imageBuffer) {
    return mcpJson({ error: "Could not find image data in response" }, 500);
  }

  const filename = `course-covers/${Date.now()}-${Math.random().toString(36).slice(2, 11)}.png`;
  const gcsUrl = await uploadToGCS(imageBuffer, filename, "image/png");

  console.info("[mcp-audit] program_cover_generate", { actor: "mcp", filename });

  return mcpJson({ url: gcsUrl });
}
