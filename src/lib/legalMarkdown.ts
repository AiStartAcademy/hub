// src/lib/legalMarkdown.ts
//
// Minimal, dependency-free markdown → HTML renderer for legal documents.
//
// Extracted from the inline renderer in src/app/(dashboard)/waiver/page.tsx so the
// waiver page, the consent page, and /legal/[key] all render identical HTML from the
// same source files. Deliberately tiny: legal docs are headings, paragraphs, lists,
// bold, and rules. Everything is HTML-escaped BEFORE any formatting is applied, so a
// markdown file can never inject markup — these files are ours, but the escape-first
// order is what makes that guarantee structural rather than a matter of trust.

/** Strips HTML-comment lines (used for DRAFT / provenance notes in the source files). */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineFormatting(input: string): string {
  // Bold first — otherwise the italic pattern would claim the inner pair of a `**x**`.
  return input
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
}

const UNORDERED_ITEM = /^[-*]\s+(.+)$/;
const ORDERED_ITEM = /^\d+\.\s+(.+)$/;
const HEADING = /^(#{1,4})\s+(.+)$/;
const RULE = /^-{3,}$/;

export function renderLegalMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown.replace(HTML_COMMENT, "")).replace(/\r\n?/g, "\n");
  const lines = escaped.split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";

    if (!line) {
      index += 1;
      continue;
    }

    // A horizontal rule has to be tested before the unordered-list pattern:
    // "---" would otherwise never match, but "- --" style variants would.
    if (RULE.test(line)) {
      html.push("<hr />");
      index += 1;
      continue;
    }

    const headingMatch = HEADING.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineFormatting(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    for (const [pattern, tag] of [
      [UNORDERED_ITEM, "ul"],
      [ORDERED_ITEM, "ol"],
    ] as const) {
      if (!pattern.test(line)) continue;

      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index]?.trim() ?? "");
        if (!match) break;
        items.push(`<li>${renderInlineFormatting(match[1])}</li>`);
        index += 1;
      }
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      break;
    }
    // The loop above consumed at least one line if it matched, so re-test the
    // current line rather than assuming we still need to build a paragraph.
    if (UNORDERED_ITEM.test(line) || ORDERED_ITEM.test(line)) {
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index]?.trim() ?? "";
      if (
        !paragraphLine ||
        HEADING.test(paragraphLine) ||
        RULE.test(paragraphLine) ||
        UNORDERED_ITEM.test(paragraphLine) ||
        ORDERED_ITEM.test(paragraphLine)
      ) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }

    html.push(`<p>${renderInlineFormatting(paragraphLines.join(" "))}</p>`);
  }

  return html.join("\n");
}
