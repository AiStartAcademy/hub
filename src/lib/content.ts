// src/lib/content.ts
// Shared helpers for the content platform (blog posts + landing pages).
// JSON-bearing columns are stored as String (SQLite) — (de)serialize here.

export const CONTENT_TYPES = ["BLOG", "LANDING"] as const;
export type ContentTypeStr = (typeof CONTENT_TYPES)[number];

export const CONTENT_STATUSES = [
  "DRAFT",
  "GENERATING",
  "READY_FOR_REVIEW",
  "IN_REVIEW",
  "PUBLISHED",
  "DISABLED",
  "ARCHIVED",
] as const;
export type ContentStatusStr = (typeof CONTENT_STATUSES)[number];

// Available render templates per content type. Currently one "default" each —
// the render pipeline only implements "default"; add entries here as templates ship.
export const CONTENT_TEMPLATES: Record<ContentTypeStr, { value: string; label: string }[]> = {
  BLOG: [{ value: "default", label: "Default blog post" }],
  LANDING: [{ value: "default", label: "Default landing page" }],
};

export function isValidTemplate(type: string, template: string): boolean {
  const list = CONTENT_TEMPLATES[type as ContentTypeStr];
  return !!list && list.some((t) => t.value === template);
}

// Columns holding JSON encoded as text.
export const JSON_FIELDS = [
  "sections",
  "faq",
  "sources",
  "videos",
  "ctas",
  "inlineImages",
] as const;

/** Blog posts live under /blog/<slug>/; landing pages at the site root /<slug>/. */
export function deriveUrl(type: string, slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, "");
  return type === "BLOG" ? `/blog/${clean}/` : `/${clean}/`;
}

/** Encode incoming object-valued fields to JSON strings for storage. */
export function serializeJsonFields<T extends Record<string, unknown>>(
  input: T
): T {
  const out: Record<string, unknown> = { ...input };
  for (const f of JSON_FIELDS) {
    if (out[f] !== undefined && out[f] !== null && typeof out[f] !== "string") {
      out[f] = JSON.stringify(out[f]);
    }
  }
  return out as T;
}

/** Decode stored JSON strings back to objects (for the site generator/API). */
export function parseJsonFields<T extends Record<string, unknown>>(
  row: T
): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of JSON_FIELDS) {
    const v = out[f];
    if (typeof v === "string" && v.length) {
      try {
        out[f] = JSON.parse(v);
      } catch {
        // leave the raw string if it isn't valid JSON — never throw on read
      }
    }
  }
  return out as T;
}
