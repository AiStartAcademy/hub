export const TRANSCRIPT_MAX_LENGTH = 100_000;

const RECORDING_PROXY_PATTERN = /^\/api\/twilio\/recordings\/(RE[0-9a-f]{32})$/;
const PATCH_FIELDS = new Set(["transcript", "summary", "analysis", "force"]);
const STRING_PATCH_FIELDS = ["transcript", "summary", "analysis"] as const;

export interface CallListQuery {
  needsTranscript: boolean;
  provider: string;
  limit: number;
  since?: Date;
  providerCallId?: string;
  cursor?: string;
}

export type CallPatch = Partial<Record<(typeof STRING_PATCH_FIELDS)[number], string>> & {
  force?: boolean;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseRecordingSid(recordingUrl: string | null): string | null {
  if (!recordingUrl) return null;
  return RECORDING_PROXY_PATTERN.exec(recordingUrl)?.[1] ?? null;
}

function optionalBoundedParam(url: URL, name: string, maxLength: number): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value.slice(0, maxLength) : undefined;
}

export function parseCallListQuery(url: URL): ParseResult<CallListQuery> {
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const rawSince = optionalBoundedParam(url, "since", 64);
  let since: Date | undefined;
  if (rawSince) {
    since = new Date(rawSince);
    if (Number.isNaN(since.valueOf())) return { ok: false, error: "Invalid since date" };
  }

  const provider = optionalBoundedParam(url, "provider", 64) ?? "twilio";
  const providerCallId = optionalBoundedParam(url, "providerCallId", 128);
  const cursor = optionalBoundedParam(url, "cursor", 128);
  return {
    ok: true,
    value: {
      needsTranscript: url.searchParams.get("needsTranscript") === "1",
      provider,
      limit,
      ...(since ? { since } : {}),
      ...(providerCallId ? { providerCallId } : {}),
      ...(cursor ? { cursor } : {}),
    },
  };
}

export function validateCallPatch(body: unknown): ParseResult<CallPatch> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Patch body must be an object" };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!PATCH_FIELDS.has(key)) return { ok: false, error: `Unknown field: ${key}` };
  }
  if (keys.length === 0 || !STRING_PATCH_FIELDS.some((field) => field in record)) {
    return { ok: false, error: "Patch body is empty" };
  }

  const value: CallPatch = {};
  for (const field of STRING_PATCH_FIELDS) {
    if (!(field in record)) continue;
    const fieldValue = record[field];
    if (typeof fieldValue !== "string") {
      return { ok: false, error: `${field} must be a string` };
    }
    value[field] = fieldValue;
  }
  if (value.transcript && value.transcript.length > TRANSCRIPT_MAX_LENGTH) {
    return {
      ok: false,
      error: `transcript exceeds ${TRANSCRIPT_MAX_LENGTH} characters`,
    };
  }
  if (value.analysis !== undefined) {
    try {
      JSON.parse(value.analysis);
    } catch {
      return { ok: false, error: "analysis must be valid JSON text" };
    }
  }
  if ("force" in record) {
    if (typeof record.force !== "boolean") {
      return { ok: false, error: "force must be a boolean" };
    }
    value.force = record.force;
  }
  return { ok: true, value };
}
