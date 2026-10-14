import sanitizeHtml from "sanitize-html";

/**
 * Staff-authored outreach is previewed in the browser as well as sent by mail,
 * so it gets the same strict allowlist regardless of who authored the draft.
 */
export function sanitizeEmailHtml(input: string): string {
  if (typeof input !== "string") return "";

  return sanitizeHtml(input.slice(0, 50_000), {
    allowedTags: [
      "p", "br", "strong", "em", "b", "i", "u", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "blockquote", "span", "div", "img", "hr",
      "table", "tbody", "tr", "td", "th",
    ],
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    nonTextTags: ["script", "style", "iframe", "object", "template", "textarea"],
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, rel: "noopener noreferrer" },
      }),
    },
    allowedAttributes: {
      a: ["href", "title", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      table: ["width"],
      td: ["width", "colspan", "rowspan"],
      th: ["width", "colspan", "rowspan"],
    },
  });
}
