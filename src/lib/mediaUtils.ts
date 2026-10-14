// src/lib/mediaUtils.ts
// Client-safe media URL utilities — no Node.js dependencies, safe to import in Client Components

import { logger } from "./logger";

const PROXY_PREFIX = "/api/media/";

/** Lazily resolved to catch missing env var at call time, not at module load */
function getGcsBaseUrl(): string {
  const bucket = process.env.NEXT_PUBLIC_GCS_BUCKET_NAME;
  if (!bucket) {
    logger.error("[mediaUtils] NEXT_PUBLIC_GCS_BUCKET_NAME is not set");
    return "";
  }
  return `https://storage.googleapis.com/${bucket}`;
}

/**
 * Converts a GCS object key to a proxy URL for client-side use.
 * External URLs (http/https) are returned as-is.
 * Example: "courses/slug/module/lesson/video.mp4" → "/api/media/courses/slug/module/lesson/video.mp4"
 */
export function getProxyUrl(objectKey: string): string {
  if (!objectKey) return "";
  if (objectKey.startsWith("http://") || objectKey.startsWith("https://")) {
    return objectKey;
  }
  const key = objectKey.startsWith("/") ? objectKey.slice(1) : objectKey;
  return `${PROXY_PREFIX}${key}`;
}

/**
 * Extracts a GCS object key from a proxy URL.
 * If the input is already a plain object key — returns as-is.
 * Example: "/api/media/courses/clx123/video.mp4" → "courses/clx123/video.mp4"
 */
export function getObjectKey(proxyUrlOrKey: string): string {
  if (!proxyUrlOrKey) return "";
  if (proxyUrlOrKey.startsWith(PROXY_PREFIX)) {
    return proxyUrlOrKey.slice(PROXY_PREFIX.length);
  }
  return proxyUrlOrKey;
}

/**
 * Converts a GCS object key to a full public-style GCS URL for display.
 * Used in admin/editor UI so users can copy/paste real GCS URLs.
 * Example: "courses/slug/video.mp4" → "https://storage.googleapis.com/bucket/courses/slug/video.mp4"
 * External URLs (http/https) are returned as-is.
 */
export function keyToGcsUrl(objectKey: string): string {
  if (!objectKey) return "";
  if (objectKey.startsWith("http://") || objectKey.startsWith("https://")) {
    return objectKey;
  }
  const base = getGcsBaseUrl();
  // If env var missing — fall back to proxy URL so the app doesn't break
  if (!base) return getProxyUrl(objectKey);
  const key = objectKey.startsWith("/") ? objectKey.slice(1) : objectKey;
  return `${base}/${key}`;
}

/**
 * Converts a full GCS URL back to an object key for storage.
 * If the input is already a plain object key — returns as-is.
 * Example: "https://storage.googleapis.com/bucket/courses/slug/video.mp4" → "courses/slug/video.mp4"
 */
export function gcsUrlToKey(urlOrKey: string): string {
  if (!urlOrKey) return "";
  // Strip GCS base URL prefix
  const prefix = `https://storage.googleapis.com/`;
  if (urlOrKey.startsWith(prefix)) {
    const withoutBase = urlOrKey.slice(prefix.length);
    // withoutBase = "bucket-name/courses/..." — strip bucket name
    const slashIdx = withoutBase.indexOf("/");
    if (slashIdx !== -1) {
      return withoutBase.slice(slashIdx + 1);
    }
    return withoutBase;
  }
  // Already an object key or proxy URL
  if (urlOrKey.startsWith(PROXY_PREFIX)) {
    return urlOrKey.slice(PROXY_PREFIX.length);
  }
  return urlOrKey;
}

/**
 * Extracts fileId from various Google Drive URL formats.
 * Client-safe: pure string operations only.
 * https://drive.google.com/file/d/FILE_ID/view
 * https://drive.google.com/uc?id=FILE_ID
 */
export function extractDriveFileId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}


/**
 * Converts a Drive URL to a proxy URL for the browser.
 * If not a Drive URL — returns as-is.
 * Client-safe: pure string operations only.
 */
export function driveUrlToProxy(url: string): string {
  const fileId = extractDriveFileId(url);
  if (!fileId) return url;
  return `/api/drive/${fileId}`;
}

