import sanitizeHtml from "sanitize-html";

// Allowlist sanitizer for user-authored rich text (cohort descriptions, etc.)
// rendered publicly via dangerouslySetInnerHTML. Shared by the cohorts list and
// the public detail view so the policy stays in one place.
export function sanitizeDescription(html: string | null): string | null {
  if (!html) return null;

  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "h4",
      "ul", "ol", "li", "blockquote", "a", "img", "code", "pre", "hr", "span",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      p: ["style"],
      span: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "text-align": [/^(left|right|center|justify)$/],
      },
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, rel: "noopener noreferrer" },
      }),
    },
  });
}

/**
 * Allowlist sanitizer for staff-authored drip email bodies (DripStep.body).
 *
 * Wider than sanitizeDescription because email has no external stylesheet — every
 * rule has to be an inline `style`, so inline styles are allowed on any tag rather
 * than a handful. The allowlist still excludes script/iframe/object/style/link and
 * every event-handler attribute, and restricts URL schemes, so a compromised staff
 * account cannot turn the template into a script-delivery vehicle. The same HTML is
 * previewed in the admin UI, so this is not email-only hardening.
 */
export function sanitizeEmailBody(html: string): string {
  return sanitizeHtml(html.slice(0, 20000), {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "h4",
      "ul", "ol", "li", "blockquote", "a", "img", "code", "pre", "hr",
      "span", "div", "table", "thead", "tbody", "tr", "td", "th",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      table: ["width", "cellpadding", "cellspacing", "border", "role"],
      td: ["width", "align", "valign", "colspan", "rowspan"],
      th: ["width", "align", "valign", "colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "background": [/^#[0-9a-f]{3,8}$/i],
        "text-align": [/^(left|right|center|justify)$/],
        "text-decoration": [/^(none|underline|line-through)$/],
        "font-size": [/^\d{1,3}px$/],
        "font-weight": [/^(normal|bold|[1-9]00)$/],
        "font-family": [/^[\w\s,'"-]{1,200}$/],
        "line-height": [/^\d(\.\d+)?$/, /^\d{1,3}px$/],
        margin: [/^[\d\spx]{1,40}$/, /^0$/],
        padding: [/^[\d\spx]{1,40}$/, /^0$/],
        "padding-left": [/^\d{1,3}px$/],
        "border-radius": [/^\d{1,3}px$/],
        display: [/^(block|inline-block|inline|none)$/],
        border: [/^[\w\s#-]{1,60}$/],
        "border-top": [/^[\w\s#-]{1,60}$/],
        "max-width": [/^\d{1,4}px$/],
      },
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, rel: "noopener noreferrer" },
      }),
    },
  });
}
