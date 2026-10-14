// src/lib/mailText.ts

/**
 * Derive a plain-text alternative part from an HTML email body.
 *
 * Why this exists: HTML-only mail is one of the loudest spam signals there is —
 * every mainstream filter expects a `multipart/alternative` with a real text
 * part, and the academy's mail was landing in spam partly because we
 * never sent one. `sendMail` calls this whenever the caller doesn't supply its
 * own `text`.
 *
 * Deliberately dependency-free (no `html-to-text`, no DOM): our templates are
 * a small, known set of hand-written table/div layouts, not arbitrary web
 * pages, so a regex pipeline is enough and keeps the send path free of a new
 * runtime dependency. It is not a general-purpose HTML parser and shouldn't be
 * used as one.
 */

/**
 * Named entities we decode. The hand-written templates only ever emit the
 * first five, but campaign and outreach bodies are authored by humans in the
 * admin editor and routinely carry typographic entities pasted from a word
 * processor. An undecoded `&mdash;` in the text part is exactly the kind of
 * sloppy signal this whole change exists to remove, so the common typographic
 * set is decoded too. Anything outside this table is left verbatim rather than
 * guessed at.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Dashes, ellipsis and separators.
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  bull: "•",
  // Smart quotes.
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  // Symbols that show up in pricing and legal lines.
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  euro: "€",
  pound: "£",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const codePoint = entity[1] === "x" || entity[1] === "X"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Tags whose *content* is machinery, not message — dropped wholesale. */
const DROPPED_CONTENT = /<(style|script|head|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Tags that end the current line when they open or close. */
const LINE_BREAKING =
  /<\s*\/?\s*(br|p|div|li|ul|ol|tr|table|h[1-6]|header|footer|section|article|blockquote|hr)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  if (!html) return "";

  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(DROPPED_CONTENT, "");

  // Anchors become "label (url)" so a text-only reader can still follow the
  // link — unless the label already *is* the URL, which would read as noise.
  text = text.replace(
    /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_match, _raw, dq, sq, bare, inner: string) => {
      const href = decodeEntities((dq ?? sq ?? bare ?? "").trim());
      const label = decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
      if (!href || href.startsWith("#")) return label;
      if (!label) return href;
      if (label === href) return label;
      return `${label} (${href})`;
    }
  );

  text = text
    .replace(LINE_BREAKING, "\n")
    .replace(/<[^>]*>/g, "");

  text = decodeEntities(text);

  return text
    .split("\n")
    // Non-breaking spaces decoded above are ordinary spaces now; collapse every
    // whitespace run inside a line, then drop lines that held only markup.
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}
