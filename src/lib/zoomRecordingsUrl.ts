// src/lib/zoomRecordingsUrl.ts
//
// Pure helpers for fetching one Zoom meeting instance's cloud recordings.
// GET /v2/meetings/{numericId}/recordings returns ONLY the latest instance of a
// recurring meeting; past instances need the instance UUID in the path.
// No imports: safe to load in unit tests without Prisma/GCS/secrets.

const ZOOM_API = "https://api.zoom.us/v2";

/** Zoom's rule: a UUID that starts with "/" or contains "//" must be double URL-encoded;
 *  any other UUID is encoded once (base64 "+", "/" and "=" still need escaping). */
export function encodeZoomMeetingUuid(uuid: string): string {
  const once = encodeURIComponent(uuid);
  return uuid.startsWith("/") || uuid.includes("//") ? encodeURIComponent(once) : once;
}

export function zoomRecordingsUrl(meetingId: string, instanceUuid?: string | null): string {
  const pathId = instanceUuid ? encodeZoomMeetingUuid(instanceUuid) : meetingId;
  return `${ZOOM_API}/meetings/${pathId}/recordings`;
}

export type SyncRecordingsBody =
  | { ok: true; zoomInstanceUuid: string | null }
  | { ok: false; status: 400; error: string };

/** Parses the optional body of POST /api/cohorts/[id]/sessions/sync. An empty body keeps
 *  the original behavior (latest instance only). */
export function parseSyncRecordingsBody(raw: string): SyncRecordingsBody {
  if (!raw.trim()) return { ok: true, zoomInstanceUuid: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "Body must be JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: "Body must be a JSON object" };
  }

  const value = (parsed as Record<string, unknown>).zoomInstanceUuid;
  if (value === undefined || value === null) return { ok: true, zoomInstanceUuid: null };
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, status: 400, error: "zoomInstanceUuid must be a non-empty string" };
  }
  return { ok: true, zoomInstanceUuid: value.trim() };
}
