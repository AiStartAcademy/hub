// src/app/legal/[key]/page.tsx
//
// Public, standalone view of any legal document at its current version. Outside the
// (dashboard) group deliberately: emails, the consent page, and the marketing site all
// link here, and none of those readers is necessarily signed in.
import type { JSX } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  LEGAL_DOCS,
  LEGAL_DOC_KEYS,
  getLegalDocMarkdown,
  isLegalDocKey,
} from "@/lib/legalDocs";
import { renderLegalMarkdown } from "@/lib/legalMarkdown";

export function generateStaticParams() {
  return LEGAL_DOC_KEYS.map((key) => ({ key }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  if (!isLegalDocKey(key)) return { title: "Not found" };
  const doc = LEGAL_DOCS[key];
  return {
    // No academy-name suffix here: the root layout already applies a title
    // template, and spelling it out again duplicated the academy name.
    title: doc.title,
    description: doc.summary,
    alternates: { canonical: `/legal/${key}` },
  };
}

export default async function LegalDocPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<JSX.Element> {
  const { key } = await params;
  if (!isLegalDocKey(key)) notFound();

  const doc = LEGAL_DOCS[key];
  const html = renderLegalMarkdown(getLegalDocMarkdown(key));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">
          {doc.title}
        </h1>
        <p className="max-w-2xl text-base leading-7 text-slate-700 dark:text-slate-300">
          {doc.summary}
        </p>
        <p className="text-sm text-slate-500">Version {doc.version}</p>
      </header>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950">
        <p className="text-sm font-semibold uppercase tracking-[0.14em]">
          DRAFT - pending legal review
        </p>
        <p className="mt-2 text-sm leading-6">
          This copy is published for implementation work and is not yet final legal text.
        </p>
      </section>

      <article
        className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 prose-p:leading-7 prose-li:leading-7"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
