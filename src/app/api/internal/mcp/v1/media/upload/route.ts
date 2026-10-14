/**
 * MCP-authenticated media upload. Accepts a base64-encoded file, stores it in
 * GCS using the same key convention as the admin UI's /api/upload
 * (media/{namespace}/{slug}/…), and creates a Media row so the file appears in
 * the Media manager like any other upload.
 *
 * `public: true` inserts a `previews/` segment into the key
 * (media/{ns}/{slug}/previews/{file}) — that prefix is the one the
 * /api/media/[...path] route serves WITHOUT authentication, which is what
 * marketing pages need for guest visitors. Default is a private key.
 */
import prisma from "@/lib/prisma";
import {
  DEFAULT_MEDIA_NAMESPACE,
  MEDIA_PREFIX,
  currentMonthSlug,
  resolveMediaKey,
  slugifyFilename,
  toSlug,
  uploadToGCS,
} from "@/lib/gcs";
import { getProxyUrl } from "@/lib/mediaUtils";
import { logger } from "@/lib/logger";
import { mcpError, mcpJson, mcpWritesEnabled, requireMcpToken } from "@/lib/mcpApi";

export const dynamic = "force-dynamic";

const WRITES_DISABLED_MESSAGE =
  "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true'). Blocked here too: this call writes a file to GCS and a Media row to the database.";

// Marketing photos, not video hosting — keep the payload bounded.
// This route carries its payload as base64 inside a JSON body, so the cap is
// deliberately modest. Extracted lesson audio (50-150MB for a 2-3h session) is
// NOT meant to travel through here — the n8n extract-audio callback
// (/api/n8n/extract-audio-callback) uploads it to GCS server-side via
// uploadToGCS instead. Do not inflate this cap to accommodate lesson audio.
// If this value ever does change, hub-mcp mirrors it as HUB_MAX_UPLOAD_BYTES in
// hub-mcp/src/tools/media-upload.ts and must be updated in lockstep.
const MAX_BYTES = 15 * 1024 * 1024;

// Must stay in agreement with the client-side allowlist in
// hub-mcp/src/tools/media-upload.ts.
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/vtt",
  "application/x-subrip",
  "application/json",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/aac",
  "audio/ogg",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function detectType(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "document";
  return "other";
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpJson({ error: WRITES_DISABLED_MESSAGE }, 403);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) return mcpError("Expected a JSON object body", 400);
    body = parsed;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mcpError("Invalid JSON", 400);
  }

  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "";
  const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
  const namespace = typeof body.namespace === "string" ? body.namespace : null;
  const slug = typeof body.slug === "string" ? body.slug : null;
  const isPublic = body.public === true;

  if (!filename) return mcpError("filename is required", 400);
  if (!ALLOWED_MIME.has(mimeType)) {
    return mcpError(
      `mimeType must be one of: ${[...ALLOWED_MIME].join(", ")}`,
      400
    );
  }
  if (!dataBase64) return mcpError("dataBase64 is required", 400);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return mcpError("dataBase64 is not valid base64", 400);
  }
  if (buffer.length === 0) return mcpError("Decoded file is empty", 400);
  if (buffer.length > MAX_BYTES) {
    return mcpError(
      `File too large: ${buffer.length} bytes (max ${MAX_BYTES})`,
      400
    );
  }

  const ns = toSlug(namespace ?? "") || DEFAULT_MEDIA_NAMESPACE;
  const sl = toSlug(slug ?? "") || currentMonthSlug();
  const file = slugifyFilename(filename);
  const desiredKey = isPublic
    ? `${MEDIA_PREFIX}/${ns}/${sl}/previews/${file}`
    : `${MEDIA_PREFIX}/${ns}/${sl}/${file}`;
  const objectKey = await resolveMediaKey(desiredKey);

  await uploadToGCS(buffer, objectKey, mimeType);
  const url = getProxyUrl(objectKey);

  await prisma.media.create({
    data: {
      name: filename,
      url,
      type: detectType(mimeType),
      size: buffer.length,
      folderId: null,
    },
  });

  logger.info(
    `[mcp media/upload] ${objectKey} (${buffer.length} bytes, public=${isPublic})`
  );

  return mcpJson({ url, objectKey, size: buffer.length, public: isPublic });
}
