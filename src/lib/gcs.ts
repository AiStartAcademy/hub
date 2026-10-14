// src/lib/gcs.ts
import { Storage } from "@google-cloud/storage";
import type { Readable } from "stream";
import { getProxyUrl, getObjectKey } from "@/lib/mediaUtils";
import { logger } from "./logger";
export { getProxyUrl, getObjectKey };

function normalizePrivateKey(key: string | undefined): string | undefined {
  if (!key) return key;
  // 1. Strip surrounding double or single quotes, if any
  let normalizedKey = key.replace(/^["']|["']$/g, "");
  // 2. Replace every literal \n with a real newline
  return normalizedKey.replace(/\\n/g, "\n");
}

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: {
    client_email: process.env.GCS_CLIENT_EMAIL,
    private_key: normalizePrivateKey(process.env.GCS_PRIVATE_KEY),
  },
});

/** True when GCS is set up; without it, optional GCS-backed features list nothing instead of failing. */
export function isGcsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GCS_BUCKET_NAME && env.GCS_CLIENT_EMAIL && env.GCS_PRIVATE_KEY);
}

export const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'dummy-build-bucket');

// ─── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Builds a deterministic GCS object key for a lesson asset.
 * Slug is sanitized: spaces → hyphens, lowercased, non-alphanumeric stripped.
 *
 * Example: buildObjectKey("clx123", "Intro to React", "video.mp4")
 *          → "courses/clx123/intro-to-react/video.mp4"
 */
/** Converts any string to a URL-safe slug */
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Builds a deterministic GCS object key for a lesson asset.
 * Pattern: courses/{course-slug}/{module-slug}/{lesson-slug}/{filename}
 *
 * Example: buildObjectKey("AI Fundamentals", "Module 1", "Intro to AI", "video.mp4")
 *          → "courses/ai-fundamentals/module-1/intro-to-ai/video.mp4"
 */
export function buildObjectKey(
  courseName: string,
  moduleName: string,
  lessonName: string,
  filename: string
): string {
  return `courses/${toSlug(courseName)}/${toSlug(moduleName)}/${toSlug(lessonName)}/${filename}`;
}

// ─── Generic media keys ───────────────────────────────────────────────────────

/** Prefix under which all generic (non-lesson) media lives. */
export const MEDIA_PREFIX = "media";

/** Default namespace when the caller does not supply one. */
export const DEFAULT_MEDIA_NAMESPACE = "general";

/** Returns the current YYYY-MM, used as the default slug for the "general" namespace. */
export function currentMonthSlug(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Slugifies a filename while preserving (and lowercasing) its extension.
 *
 * Example: slugifyFilename("Space Photo — Workshop.JPEG") → "space-photo-workshop.jpeg"
 */
export function slugifyFilename(filename: string): string {
  const base = (filename.split("/").pop() ?? filename).trim();
  const dot = base.lastIndexOf(".");
  const hasExt = dot > 0 && dot < base.length - 1;

  const stem = hasExt ? base.slice(0, dot) : base;
  const ext = hasExt ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";

  const slugStem = toSlug(stem) || "file";
  return ext ? `${slugStem}.${ext}` : slugStem;
}

/**
 * Builds a deterministic, predictable GCS object key for generic media.
 * Pattern: media/{namespace}/{slug}/{slugified-filename}
 *
 * Unlike the legacy `files/{timestamp}-{random}-{name}` scheme, this key can be
 * predicted (and therefore written into content) BEFORE the upload exists.
 *
 * Example: buildMediaKey("locations", "San Francisco", "Garden.JPEG")
 *          → "media/locations/san-francisco/garden.jpeg"
 */
export function buildMediaKey(
  namespace: string | null | undefined,
  slug: string | null | undefined,
  filename: string
): string {
  const ns = toSlug(namespace ?? "") || DEFAULT_MEDIA_NAMESPACE;
  const sl = toSlug(slug ?? "") || currentMonthSlug();
  return `${MEDIA_PREFIX}/${ns}/${sl}/${slugifyFilename(filename)}`;
}

/**
 * Returns a sibling key with a numeric disambiguator appended to the stem.
 * Example: withKeySuffix("media/general/2026-08/logo.png", 2)
 *          → "media/general/2026-08/logo-2.png"
 */
export function withKeySuffix(key: string, n: number): string {
  const slash = key.lastIndexOf("/");
  const dir = key.slice(0, slash + 1);
  const base = key.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const hasExt = dot > 0 && dot < base.length - 1;
  return hasExt
    ? `${dir}${base.slice(0, dot)}-${n}${base.slice(dot)}`
    : `${dir}${base}-${n}`;
}

/** Maximum disambiguator tried before giving up. */
const MAX_KEY_COLLISION_ATTEMPTS = 100;

/**
 * Resolves a collision-free object key.
 *
 * Tries `baseKey` first, then `baseKey` with -2, -3, … appended to the stem.
 * A candidate is free when it does not exist in GCS AND `isTaken` (an optional
 * caller-supplied DB check, e.g. against the Media table) returns false.
 *
 * Note: this is best-effort, not atomic — two concurrent uploads of the same
 * filename can still race. That is an acceptable trade for predictable keys;
 * the loser overwrites, it does not corrupt.
 */
export async function resolveMediaKey(
  baseKey: string,
  isTaken?: (candidate: string) => Promise<boolean>
): Promise<string> {
  for (let n = 1; n <= MAX_KEY_COLLISION_ATTEMPTS; n++) {
    const candidate = n === 1 ? baseKey : withKeySuffix(baseKey, n);

    const [exists] = await bucket.file(candidate).exists();
    if (exists) continue;

    if (isTaken && (await isTaken(candidate))) continue;

    return candidate;
  }

  throw new Error(
    `[GCS] Could not resolve a free media key for ${baseKey} after ${MAX_KEY_COLLISION_ATTEMPTS} attempts`
  );
}

/**
 * Deterministic thumbnail key for a generic media object.
 * Example: media/general/2026-08/deck.pdf → media/general/2026-08/previews/deck.pdf.png
 */
export function buildMediaThumbnailKey(objectKey: string): string {
  const slash = objectKey.lastIndexOf("/");
  const dir = objectKey.slice(0, slash + 1);
  const base = objectKey.slice(slash + 1);
  return `${dir}previews/${base}.png`;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export interface GCSObjectMetadata {
  contentType: string;
  size: number;
}

export interface GCSReadStreamRange {
  start?: number;
  end?: number;
}

/**
 * Fetches content type and byte size for an object stored in GCS.
 */
export async function getGCSObjectMetadata(
  objectKey: string,
  fallbackContentType = "application/octet-stream"
): Promise<GCSObjectMetadata> {
  // The GCS client does not expose per-call AbortSignal timeouts here.
  // Callers intentionally rely on the enclosing request/job lifetime instead.
  const [metadata] = await bucket.file(objectKey).getMetadata();
  const contentType =
    typeof metadata.contentType === "string" && metadata.contentType.length > 0
      ? metadata.contentType
      : fallbackContentType;
  const size = Number.parseInt(String(metadata.size ?? "0"), 10);

  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`[GCS] Invalid size metadata for ${objectKey}: ${String(metadata.size)}`);
  }

  return { contentType, size };
}

/**
 * Creates a Node.js readable stream for a GCS object, optionally bounded to a byte range.
 */
export function createGCSReadStream(
  objectKey: string,
  range?: GCSReadStreamRange
): Readable {
  return bucket.file(objectKey).createReadStream(range);
}

/**
 * Wraps a Node.js readable stream into a web ReadableStream for NextResponse bodies.
 */
export function nodeReadableToWebStream(
  stream: Readable
): ReadableStream<Uint8Array> {
  const reader = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.next();
      if (done) {
        controller.close();
        return;
      }

      if (typeof value === "string") {
        controller.enqueue(Buffer.from(value));
        return;
      }

      controller.enqueue(new Uint8Array(value));
    },
    cancel() {
      stream.destroy();
    },
  });
}

/**
 * Downloads a full GCS object into memory.
 */
export async function downloadFromGCS(objectKey: string): Promise<Buffer> {
  // The GCS client does not expose per-call AbortSignal timeouts here.
  // Callers intentionally rely on the enclosing request/job lifetime instead.
  const [buffer] = await bucket.file(objectKey).download();
  return buffer;
}

/**
 * Maps an audio MIME type to the file extension used for lesson-audio storage.
 */
export function audioExtensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "webm";
    default: {
      const subtype = mimeType
        .slice("audio/".length)
        .split("+")[0]
        .replace(/[^a-z0-9]/g, "");
      return subtype || "bin";
    }
  }
}

/**
 * Builds the canonical lesson-audio sibling key under the video's parent directory.
 *
 * Example:
 * "courses/course/module/lesson/video.mp4" + "audio/mpeg"
 *   → "courses/course/module/lesson/lesson-audio/audio.mp3"
 */
export function buildLessonAudioObjectKey(
  videoUrlOrObjectKey: string,
  mimeType: string
): string {
  const videoObjectKey = getObjectKey(videoUrlOrObjectKey);
  if (!isGCSKey(videoObjectKey)) {
    throw new Error(
      "Lesson videoUrl must be a private GCS object key before audio can be uploaded"
    );
  }

  const lastSlash = videoObjectKey.lastIndexOf("/");
  if (lastSlash <= 0) {
    throw new Error(`Lesson videoUrl has no parent directory: ${videoObjectKey}`);
  }

  return `${videoObjectKey.slice(0, lastSlash)}/lesson-audio/audio.${audioExtensionForMime(mimeType)}`;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Uploads a Buffer to GCS. Returns a proxy URL (legacy, used for images/docs).
 */
export async function uploadToGCS(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const file = bucket.file(filename);
  await file.save(buffer, {
    metadata: { contentType: mimeType },
    resumable: false,
  });
  logger.info(`[GCS] Buffer uploaded: ${filename}`);
  return getProxyUrl(filename);
}

/**
 * Streams a Readable directly into GCS without buffering in memory.
 * Returns the objectKey (relative path), NOT a proxy URL.
 * Use this for large files (video, audio).
 */
export async function uploadStreamToGCS(
  stream: Readable,
  objectKey: string,
  mimeType: string
): Promise<string> {
  logger.info(`[GCS] Starting stream upload: ${objectKey} (${mimeType})`);

  await new Promise<void>((resolve, reject) => {
    const gcsFile = bucket.file(objectKey);
    const writeStream = gcsFile.createWriteStream({
      metadata: { contentType: mimeType },
      resumable: true,
    });

    stream.on("error", (err) => {
      logger.error( {err: err.message}, `[GCS] Source stream error for ${objectKey}:`);
      reject(err);
    });
    writeStream.on("error", (err) => {
      logger.error({err: err.message},`[GCS] Write stream error for ${objectKey}:`);
      reject(err);
    });
    writeStream.on("finish", () => {
      logger.info(`[GCS] Stream upload finished: ${objectKey}`);
      resolve();
    });

    stream.pipe(writeStream);
  });

  return objectKey;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Deletes a file from GCS.
 * Accepts either an objectKey ("courses/clx123/video.mp4")
 * or a legacy proxy URL ("/api/media/courses/clx123/video.mp4").
 */
export async function deleteFromGCS(urlOrKey: string): Promise<void> {
  try {
    const objectKey = getObjectKey(urlOrKey);
    if (!objectKey) return;

    await bucket.file(objectKey).delete({ ignoreNotFound: true });
    logger.info(`[GCS] Deleted: ${objectKey}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, `[GCS] Delete error:`);
  }
}

// ─── GCS Key Detection ────────────────────────────────────────────────────────

/**
 * Returns true if the string is a GCS object key (not an external URL).
 * GCS keys start with "courses/" and don't contain "://"
 */
export function isGCSKey(value: string | null | undefined): value is string {
  if (!value) return false;
  return value.startsWith("courses/") && !value.includes("://");
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

/**
 * Copies a single GCS object from srcKey to dstKey.
 * Returns dstKey on success.
 */
export async function copyGCSObject(srcKey: string, dstKey: string): Promise<string> {
  logger.info(`[GCS] Copying: ${srcKey} → ${dstKey}`);
  await bucket.file(srcKey).copy(bucket.file(dstKey));
  logger.info(`[GCS] Copy done: ${dstKey}`);
  return dstKey;
}

/**
 * Lists all GCS object keys under a given prefix.
 */
export async function listGCSFiles(prefix: string): Promise<string[]> {
  const [files] = await bucket.getFiles({ prefix });
  return files.map((f) => f.name);
}

/**
 * Copies all GCS objects under srcPrefix to dstPrefix.
 * Returns a map of { srcKey → dstKey } for rollback purposes.
 */
export async function copyGCSPrefix(
  srcPrefix: string,
  dstPrefix: string
): Promise<Map<string, string>> {
  const files = await listGCSFiles(srcPrefix);
  const copied = new Map<string, string>();

  logger.info(`[GCS] Copying prefix ${srcPrefix} → ${dstPrefix} (${files.length} files)`);

  for (const srcKey of files) {
    const relative = srcKey.slice(srcPrefix.length);
    const dstKey = `${dstPrefix}${relative}`;
    await copyGCSObject(srcKey, dstKey);
    copied.set(srcKey, dstKey);
  }

  logger.info(`[GCS] Prefix copy done: ${copied.size} files`);
  return copied;
}

/**
 * Deletes all GCS objects under a given prefix.
 * Used for rollback.
 */
export async function deleteGCSPrefix(prefix: string): Promise<void> {
  const files = await listGCSFiles(prefix);
  logger.info(`[GCS] Deleting prefix ${prefix} (${files.length} files)`);
  await Promise.all(
    files.map((key) => bucket.file(key).delete({ ignoreNotFound: true }))
  );
  logger.info(`[GCS] Prefix deleted: ${prefix}`);
}

/**
 * Rolls back a set of copied GCS objects by deleting the destinations.
 */
export async function rollbackGCSCopies(copied: Map<string, string>): Promise<void> {
  if (copied.size === 0) return;
  logger.info(`[GCS] Rolling back ${copied.size} copied files`);
  await Promise.all(
    Array.from(copied.values()).map((dstKey) =>
      bucket.file(dstKey).delete({ ignoreNotFound: true })
    )
  );
  logger.info(`[GCS] Rollback complete`);
}

// ─── Mind Health: read JSON from GCS ─────────────────────────────────

/**
 * Reads and parses a JSON file from GCS by its full object key.
 * Returns null if the file does not exist.
 */
export async function readJsonFromGCS<T = unknown>(objectKey: string): Promise<T | null> {
  try {
    const file = bucket.file(objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      logger.info(`[GCS] File not found: ${objectKey}`);
      return null;
    }
    const buffer = await downloadFromGCS(objectKey);
    logger.info(`[GCS] Read JSON: ${objectKey} (${buffer.length} bytes)`);
    return JSON.parse(buffer.toString("utf-8")) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, `[GCS] readJsonFromGCS error (${objectKey}):`);
    return null;
  }
}

/**
 * Lists available mind-health dates by scanning the /mind-health/ prefix.
 * Extracts date strings from filenames like "mind-health/2026-06-09.json".
 * Returns sorted array (newest first).
 */
export async function listMindHealthDates(): Promise<string[]> {
  if (!isGcsConfigured()) return [];
  const files = await listGCSFiles("mind-health/");
  const dates = files
    .map((f) => {
      // "mind-health/2026-06-09.json" → "2026-06-09"
      const match = f.match(/mind-health\/(\d{4}-\d{2}-\d{2})\.json/);
      return match?.[1] ?? null;
    })
    .filter((d): d is string => d !== null)
    .sort((a, b) => b.localeCompare(a)); // newest first

  logger.info(`[GCS] Found ${dates.length} mind-health files`);
  return dates;
}

// ─── Signed URLs ──────────────────────────────────────────────────────────────

/**
 * Generates a temporary signed URL to download a file directly from Google Cloud Storage.
 * The URL is valid for 1 hour, which avoids auth issues in the student's browser.
 */
export async function generateSignedUrl(objectKey: string): Promise<string> {
  // Strip the /api/media/ prefix, if present, to get the bare object key
  const cleanKey = getObjectKey(objectKey);
  
  if (!cleanKey) return objectKey; // Fallback
  
  try {
    const [signedUrl] = await bucket.file(cleanKey).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });
    return signedUrl;
  } catch (error) {
    logger.error({ err: error }, `[GCS] Error generating signed URL for ${cleanKey}:`);
    // Fall back to the original URL on failure
    return objectKey; 
  }
}
