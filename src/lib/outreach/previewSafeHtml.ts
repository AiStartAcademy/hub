/**
 * Escape-only, client-side render guard for admin previews of email HTML.
 *
 * The authoritative policy is server-side `sanitizeEmailHtml` (sanitize-html),
 * which runs before anything is sent or stored. This is a cheap second belt for
 * HTML rendered into the admin's own browser — an unsaved paste in the campaign
 * editor, or a stored body from before the sanitizer was in place — so neither
 * can inject a live <script> into a staff session.
 *
 * Returns "" during SSR: it needs DOMParser, and a preview has nothing to show
 * before hydration anyway.
 */
export function previewSafeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, style, link, meta").forEach((el) =>
    el.remove()
  );
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name) || (attr.name === "href" && /^javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}
