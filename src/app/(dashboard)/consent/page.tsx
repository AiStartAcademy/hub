// src/app/(dashboard)/consent/page.tsx
//
// Where a student lands the first time they reach course content without having
// accepted the current legal documents. Server-renders the outstanding documents in
// full — no "click through to read it" — so the acceptance we record is against text
// that was actually on screen.
import type { JSX } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getOutstandingConsents } from "@/lib/consent";
import { LEGAL_DOCS, getLegalDocMarkdown } from "@/lib/legalDocs";
import { renderLegalMarkdown } from "@/lib/legalMarkdown";
import prisma from "@/lib/prisma";
import ConsentForm from "./ConsentForm";

export const metadata: Metadata = {
  title: "Before you start",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function safeNext(next: string | undefined): string {
  // Only same-origin relative paths — an open redirect here would be handed a logged-in
  // student straight after they clicked "I agree".
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/courses";
  return next;
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { next } = await searchParams;
  const destination = safeNext(next);

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/consent?next=${destination}`)}`);
  }

  const outstanding = await getOutstandingConsents(userId);
  if (outstanding.length === 0) {
    redirect(destination);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { marketingReleaseAt: true },
  });

  const documents = outstanding.map((key) => ({
    key,
    title: LEGAL_DOCS[key].title,
    summary: LEGAL_DOCS[key].summary,
    version: LEGAL_DOCS[key].version,
    html: renderLegalMarkdown(getLegalDocMarkdown(key)),
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8 flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
          Before you start
        </p>
        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
          A few things to agree to
        </h1>
        <p className="max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">
          Your seat is confirmed. These are the policies that govern the program — how we
          handle your data, how we treat each other in the room, and what happens with the
          session recordings. Read them, then check each box. It takes a few minutes and
          you only do it once.
        </p>
      </header>

      <ConsentForm
        documents={documents}
        marketingReleaseGranted={Boolean(user?.marketingReleaseAt)}
        next={destination}
      />
    </div>
  );
}
