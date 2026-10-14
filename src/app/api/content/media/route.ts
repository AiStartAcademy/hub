// src/app/api/content/media/route.ts
// POST — the agent uploads a generated image (base64) to GCS and gets back a URL.
// Bearer CONTENT_INGEST_TOKEN. Keeps GCS credentials on the hub — the agent never
// needs them. Body: { filename: string, contentType: string, base64: string }
import { NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/serviceAuth";
import { uploadToGCS } from "@/lib/gcs";
import { logger } from "@/lib/logger";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB guard

export async function POST(req: Request) {
  const denied = requireServiceToken(req, "CONTENT_INGEST_TOKEN");
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as
    | { filename?: string; contentType?: string; base64?: string }
    | null;
  if (!body?.base64 || !body.filename) {
    return NextResponse.json({ error: "filename and base64 are required" }, { status: 400 });
  }

  const buffer = Buffer.from(body.base64, "base64");
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }

  // Sanitize into a blog/ prefix; strip any path components from the model-supplied name.
  const safe = body.filename.split("/").pop()!.replace(/[^a-zA-Z0-9._-]/g, "-");
  const key = `blog/${Date.now()}-${safe}`;
  const url = await uploadToGCS(buffer, key, body.contentType || "image/png");

  logger.info(`[content/media] uploaded ${key} (${buffer.length} bytes)`);
  return NextResponse.json({ url, key });
}
