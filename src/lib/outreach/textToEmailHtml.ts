const EMAIL_LINK_REL = "noopener noreferrer";
const TRAILING_URL_PUNCTUATION = /[.,)!?;:]+$/;

/**
 * Text-node escaping. `"` is deliberately NOT escaped here: sanitizeEmailHtml
 * decodes `&quot;` back to `"` in text content, so escaping it would make the
 * sanitizer a mutation rather than a no-op on this output (SC5.1).
 */
function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function linkBareUrls(escapedText: string): string {
  return escapedText.replace(/https?:\/\/[^\s]+/g, (match) => {
    const trailing = match.match(TRAILING_URL_PUNCTUATION)?.[0] ?? "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    if (!url) return match;

    // A literal `"` would terminate the href attribute early; percent-encode it
    // rather than entity-escape it, so the attribute round-trips the sanitizer.
    const href = url.replaceAll('"', "%22");
    return `<a href="${href}" rel="${EMAIL_LINK_REL}">${url}</a>${trailing}`;
  });
}

/**
 * Converts staff-authored plain text to an email HTML fragment. Its markup is
 * deliberately restricted to the sanitizeEmailHtml allowlist and canonical
 * attributes, making the sanitizer a byte-for-byte no-op on this output.
 */
export function textToEmailHtml(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!normalized.trim()) return "";

  // Escape before inserting any markup: this ordering is the injection-safety invariant.
  const escaped = escapeHtml(normalized);
  return escaped
    .split(/\n\s*\n/)
    .map((block) => `<p>${linkBareUrls(block).replaceAll("\n", "<br />")}</p>`)
    .join("");
}
