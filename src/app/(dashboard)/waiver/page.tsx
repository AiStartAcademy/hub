import type { JSX } from "react";
import type { Metadata } from "next";

import { getVisitorWaiverMarkdown, WAIVER_VERSION } from "@/lib/waiver";

export const metadata: Metadata = {
  title: "Visitor Waiver",
  description: "Visitor waiver for in-person venue events and campus visits.",
  alternates: {
    canonical: "/waiver",
  },
  robots: {
    index: true,
    follow: true,
  },
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineFormatting(input: string): string {
  return input.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown).replace(/\r\n?/g, "\n");
  const lines = escaped.split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInlineFormatting(headingMatch[2]);
      html.push(`<h${level}>${content}</h${level}>`);
      index += 1;
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(line);
    if (listMatch) {
      const items: string[] = [];

      while (index < lines.length) {
        const listLine = lines[index]?.trim() ?? "";
        const match = /^[-*]\s+(.+)$/.exec(listLine);
        if (!match) {
          break;
        }
        items.push(`<li>${renderInlineFormatting(match[1])}</li>`);
        index += 1;
      }

      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index]?.trim() ?? "";
      if (!paragraphLine || /^(#{1,3})\s+/.test(paragraphLine) || /^[-*]\s+/.test(paragraphLine)) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }

    html.push(`<p>${renderInlineFormatting(paragraphLines.join(" "))}</p>`);
  }

  return html.join("\n");
}

export default async function WaiverPage(): Promise<JSX.Element> {
  // DRAFT: waiver text remains pending legal review.
  const markdown = await getVisitorWaiverMarkdown();
  const waiverHtml = renderMarkdown(markdown);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
          Visitor Waiver
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950">Visitor Waiver</h1>
        <p className="max-w-2xl text-base leading-7 text-slate-700">
          Review the current waiver before attending any in-person venue event or campus visit.
        </p>
      </header>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950">
        <p className="text-sm font-semibold uppercase tracking-[0.14em]">
          DRAFT - pending legal review
        </p>
        <p className="mt-2 text-sm leading-6">
          This waiver copy is published for implementation work and is not yet final legal text.
        </p>
      </section>

      <div className="text-sm text-slate-600">
        <span className="font-medium text-slate-900">Version:</span> {WAIVER_VERSION}
      </div>

      <article
        className="prose prose-slate max-w-none prose-headings:scroll-mt-24 prose-p:leading-7 prose-li:leading-7"
        dangerouslySetInnerHTML={{ __html: waiverHtml }}
      />
    </main>
  );
}
