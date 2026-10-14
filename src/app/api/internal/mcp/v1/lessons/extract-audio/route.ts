import prisma from "@/lib/prisma";
import {
  mcpError,
  mcpJson,
  mcpWritesEnabled,
  requireMcpToken,
} from "@/lib/mcpApi";
import { buildLessonAudioObjectKey, getObjectKey, isGCSKey } from "@/lib/gcs";
import { logger } from "@/lib/logger";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const WRITES_DISABLED_MESSAGE =
  "MCP writes are disabled on this hub (HUB_MCP_WRITES_ENABLED is not 'true').";

interface ExtractAudioTriggerPayload {
  lessonId: string;
  videoObjectKey: string;
  audioObjectKey: string;
  callbackUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

async function callbackBaseUrl(): Promise<string> {
  const configured = (await getSecret("HUB_INTERNAL_URL"))?.trim();
  return (configured || appUrl()).replace(/\/+$/, "");
}

async function triggerExtractAudioWebhook(
  webhookUrl: string,
  payload: ExtractAudioTriggerPayload
): Promise<void> {
  let parsedWebhookUrl: URL;
  try {
    parsedWebhookUrl = new URL(webhookUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`n8n extract-audio webhook URL is invalid: ${message}`);
  }

  let response: Response;
  try {
    response = await fetch(parsedWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`n8n extract-audio webhook request failed: ${message}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n extract-audio webhook failed: ${response.status} — ${text}`);
  }
}

export async function POST(req: Request) {
  const denied = await requireMcpToken(req);
  if (denied) return denied;

  if (!(await mcpWritesEnabled())) {
    return mcpJson({ error: WRITES_DISABLED_MESSAGE }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return mcpError("Invalid JSON", 400);
  }

  if (!isRecord(body)) return mcpError("Expected a JSON object body", 400);

  const lessonId =
    typeof body.lessonId === "string" ? body.lessonId.trim() : "";
  if (!lessonId) return mcpError("lessonId is required", 400);

  // Prisma and managed-secret lookups in this repo do not expose per-call
  // timeouts; these waits intentionally rely on the request lifetime and fail
  // loudly if the database or integrations store is unhealthy.
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, videoUrl: true },
  });

  if (!lesson) return mcpError("Lesson not found", 404);
  if (!lesson.videoUrl) {
    return mcpError("Lesson videoUrl is required to extract audio", 400);
  }

  const videoObjectKey = getObjectKey(lesson.videoUrl);
  if (!isGCSKey(videoObjectKey)) {
    return mcpError(
      "Lesson videoUrl must be a private GCS object key before audio extraction can start",
      400
    );
  }

  const webhookUrl = (await getSecret("N8N_EXTRACT_AUDIO_WEBHOOK_URL"))?.trim();
  if (!webhookUrl) {
    logger.error(
      "N8N_EXTRACT_AUDIO_WEBHOOK_URL not configured (checked Integrations store and env)"
    );
    return mcpJson(
      {
        error:
          "N8N_EXTRACT_AUDIO_WEBHOOK_URL is not configured — set it at /admin/integrations.",
      },
      500
    );
  }

  let payload: ExtractAudioTriggerPayload;
  try {
    const baseUrl = await callbackBaseUrl();
    payload = {
      lessonId,
      videoObjectKey,
      audioObjectKey: buildLessonAudioObjectKey(videoObjectKey, "audio/mpeg"),
      callbackUrl: new URL("/api/n8n/extract-audio-callback", baseUrl).toString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { err: message, lessonId, videoObjectKey },
      "[mcp lessons/extract-audio] Failed to build extract-audio payload"
    );
    return mcpError(`Failed to build extract-audio payload: ${message}`, 500);
  }

  try {
    await triggerExtractAudioWebhook(webhookUrl, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { err: message, lessonId, webhookUrl },
      "[mcp lessons/extract-audio] Failed to trigger n8n webhook"
    );
    return mcpError(`Failed to trigger n8n extract-audio workflow: ${message}`, 502);
  }

  logger.info(
    `[mcp lessons/extract-audio] Triggered n8n extract-audio workflow for lessonId=${lessonId}`
  );

  return mcpJson({ started: true, lessonId }, 202);
}
