import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  buildLessonAudioObjectKey,
  isGCSKey,
  uploadToGCS,
} from "@/lib/gcs";
import { logger } from "@/lib/logger";

type ExtractAudioCallbackPayload =
  | { kind: "audio-gcs-key"; lessonId: string; audioGcsKey: string }
  | { kind: "audio-url"; lessonId: string; audioUrl: string }
  | { kind: "error"; lessonId: string; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The agreed extractor contract is `{audioObjectKey, bytes, durationSec}` from
 * the service, which n8n forwards here as `audioGcsKey` plus `lessonId`.
 * `audioGcsKey` is the expected primary callback field; `audioUrl` remains an
 * explicit legacy fallback while older n8n legs are still possible.
 * Keep every body-shape assumption in this single function so future payload
 * tweaks only change one place rather than leaking across storage or DB logic.
 */
function interpretExtractAudioCallbackBody(
  body: unknown
): ExtractAudioCallbackPayload {
  if (!isRecord(body)) {
    throw new Error("Expected a JSON object body");
  }

  const lessonId =
    typeof body.lessonId === "string" ? body.lessonId.trim() : "";
  if (!lessonId) {
    throw new Error("lessonId is required");
  }

  const audioUrl =
    typeof body.audioUrl === "string" ? body.audioUrl.trim() : "";
  const audioGcsKey =
    typeof body.audioGcsKey === "string" ? body.audioGcsKey.trim() : "";
  const reportedError =
    typeof body.error === "string" ? body.error.trim() : "";

  const definedCount =
    Number(audioUrl.length > 0) +
    Number(audioGcsKey.length > 0) +
    Number(reportedError.length > 0);

  if (definedCount !== 1) {
    throw new Error("Provide exactly one of audioUrl, audioGcsKey, or error");
  }

  if (audioGcsKey) {
    return { kind: "audio-gcs-key", lessonId, audioGcsKey };
  }

  if (audioUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(audioUrl);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new Error("audioUrl must be a valid absolute URL");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("audioUrl must use http or https");
    }
    return { kind: "audio-url", lessonId, audioUrl: parsedUrl.toString() };
  }

  return { kind: "error", lessonId, error: reportedError };
}

function normalizeAudioMime(contentType: string | null): string {
  const mimeType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mimeType.startsWith("audio/")) {
    throw new Error(
      `Downloaded audioUrl returned non-audio Content-Type: ${contentType ?? "missing"}`
    );
  }
  return mimeType;
}

function isPrivateLessonAudioKey(objectKey: string): boolean {
  return isGCSKey(objectKey) && objectKey.includes("/lesson-audio/");
}

async function downloadAudioFile(
  audioUrl: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  let response: Response;
  try {
    response = await fetch(audioUrl, {
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Audio download request failed: ${message}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Audio download failed: ${response.status} — ${text}`);
  }

  const mimeType = normalizeAudioMime(response.headers.get("content-type"));
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Downloaded audio file is empty");
  }

  return { buffer, mimeType };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.N8N_WEBHOOK_SECRET;

  if (!secret) {
    logger.error("[extract-audio-callback] N8N_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${secret}`) {
    console.warn("[extract-audio-callback] Unauthorized request — invalid secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let payload: ExtractAudioCallbackPayload;
  try {
    payload = interpretExtractAudioCallbackBody(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Prisma and the repo GCS helpers do not expose AbortSignal-based timeouts.
  // Those waits intentionally rely on the request lifetime and fail loudly so
  // n8n can see a hard failure and retry when the dependency is transiently bad.
  const lesson = await prisma.lesson.findUnique({
    where: { id: payload.lessonId },
    select: { id: true, videoUrl: true },
  });

  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  if (payload.kind === "audio-gcs-key") {
    if (!isPrivateLessonAudioKey(payload.audioGcsKey)) {
      return NextResponse.json(
        {
          error:
            "audioGcsKey must be a private courses/.../lesson-audio/... GCS object key",
        },
        { status: 400 }
      );
    }

    await prisma.lesson.update({
      where: { id: payload.lessonId },
      data: { audioUrl: payload.audioGcsKey },
    });

    logger.info(
      `[extract-audio-callback] Stored provided audio key for lessonId=${payload.lessonId}: ${payload.audioGcsKey}`
    );

    return NextResponse.json({
      success: true,
      lessonId: payload.lessonId,
      updated: true,
      audioUrl: payload.audioGcsKey,
      source: "audioGcsKey",
    });
  }

  if (payload.kind === "audio-url") {
    if (!lesson.videoUrl) {
      return NextResponse.json(
        { error: "Lesson videoUrl is required to store extracted audio" },
        { status: 400 }
      );
    }

    let downloaded: { buffer: Buffer; mimeType: string };
    try {
      downloaded = await downloadAudioFile(payload.audioUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { lessonId: payload.lessonId, audioUrl: payload.audioUrl, err: message },
        "[extract-audio-callback] Failed to download extracted audio"
      );
      return NextResponse.json(
        { error: `Failed to download extracted audio: ${message}` },
        { status: 502 }
      );
    }

    let objectKey: string;
    try {
      objectKey = buildLessonAudioObjectKey(lesson.videoUrl, downloaded.mimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { lessonId: payload.lessonId, videoUrl: lesson.videoUrl, err: message },
        "[extract-audio-callback] Could not derive lesson audio object key"
      );
      return NextResponse.json(
        { error: `Could not derive lesson audio object key: ${message}` },
        { status: 400 }
      );
    }

    try {
      await uploadToGCS(downloaded.buffer, objectKey, downloaded.mimeType);
      await prisma.lesson.update({
        where: { id: payload.lessonId },
        data: { audioUrl: objectKey },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { lessonId: payload.lessonId, objectKey, err: message },
        "[extract-audio-callback] Failed to persist extracted audio"
      );
      return NextResponse.json(
        { error: `Failed to persist extracted audio: ${message}` },
        { status: 500 }
      );
    }

    logger.info(
      `[extract-audio-callback] Downloaded, uploaded, and stored audio for lessonId=${payload.lessonId}: ${objectKey}`
    );

    return NextResponse.json({
      success: true,
      lessonId: payload.lessonId,
      updated: true,
      audioUrl: objectKey,
      source: "audioUrl",
    });
  }

  // Deliberately return 200 here so n8n records the callback as delivered and
  // does not hammer the hub with retries for a failure the extractor already reported.
  logger.error(
    { lessonId: payload.lessonId, err: payload.error },
    "[extract-audio-callback] n8n reported audio extraction failure"
  );
  return NextResponse.json({
    success: true,
    lessonId: payload.lessonId,
    updated: false,
    reason: "n8n reported extraction error",
  });
}
