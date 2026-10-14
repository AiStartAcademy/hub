export const LEAD_TAG_MODES = ["add", "remove", "replace"] as const;
export type LeadTagMode = (typeof LEAD_TAG_MODES)[number];

export const MAX_LEAD_UPDATE_TAGS = 100;
export const MAX_LEAD_UPDATE_TAG_LENGTH = 100;

export function normalizeLeadTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

function parseStoredLeadTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeLeadTags(
      parsed.filter((item): item is string => typeof item === "string")
    ).slice(0, MAX_LEAD_UPDATE_TAGS);
  } catch {
    return [];
  }
}

/**
 * Add-only by default. Destructive removal or replacement must be requested
 * explicitly by the caller; malformed stored JSON is treated as an empty list.
 */
export function mergeLeadTags(
  storedTags: string | null,
  requestedTags: readonly string[],
  mode: LeadTagMode = "add"
): string[] {
  const existing = parseStoredLeadTags(storedTags);
  const requested = normalizeLeadTags(requestedTags).slice(0, MAX_LEAD_UPDATE_TAGS);

  if (mode === "replace") return requested;
  if (mode === "remove") {
    const removed = new Set(requested);
    return existing.filter((tag) => !removed.has(tag));
  }
  return normalizeLeadTags([...existing, ...requested]).slice(0, MAX_LEAD_UPDATE_TAGS);
}
