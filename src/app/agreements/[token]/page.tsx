import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { brand } from "@/config/brand";
import AgreementSignatureBlock from "@/components/venue/AgreementSignatureBlock";
import AgreementSigningDocument from "@/components/venue/AgreementSigningDocument";
import { splitAgreementMarkdownAtSignatureBlock } from "@/lib/agreementDocument";
import { extractOrganizerFields } from "@/lib/agreementTemplates";
import { getAisaSignatureDataUri } from "@/lib/aisaSignature";
import prisma from "@/lib/prisma";
import {
  formatRentalAmountSummary,
  resolvePostSignPaymentUrl,
  withPrefilledEmail,
} from "@/lib/venueAgreementPayment";

export const dynamic = "force-dynamic";

type AgreementPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string }>;
};

type AgreementRecord = {
  contentMd: string;
  status: string; // DRAFT | SENT | SIGNED | VOID — SQLite stores the union as a plain String column
  signerName: string | null;
  signerEmail: string | null;
  signerTitle: string | null;
  signatureSvg: string | null;
  signedAt: Date | null;
  aisaSignedAt: Date | null;
  aisaSignerName: string | null;
  aisaSignerTitle: string | null;
  venueEvent: {
    title: string;
    date: Date;
    organizerName: string;
    contactEmail: string;
    dealType: string;
    rentalFeeCents: number | null;
    rentalDepositCents: number | null;
    rentalPaymentUrl: string | null;
    rentalPaymentStatus: string | null;
  };
};

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInlineMarkdown(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function markdownToHtml(markdown: string): string {
  const escaped = escapeHtmlText(markdown).replace(/\r\n/g, "\n");
  const lines = escaped.split("\n");
  const blocks: string[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push(`<p>${formatInlineMarkdown(paragraphLines.join("<br />"))}</p>`);
    paragraphLines = [];
  };

  const flushList = (): void => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push(
      `<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</ul>`,
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join("");
}

const ORGANIZER_MARKER_PATTERN = /\[\[organizer:([a-zA-Z0-9_]+)\]\]/g;

/** Renders unfilled organizer markers as readable placeholder text in the preview. */
function previewOrganizerMarkers(
  contentMd: string,
  fields: { key: string; label: string }[],
): string {
  const labelsByKey = new Map(fields.map((field) => [field.key, field.label]));

  return contentMd.replace(ORGANIZER_MARKER_PATTERN, (fullMatch, key: string) => {
    const label = labelsByKey.get(key) ?? key;
    return `[${label} — provided at signing]`;
  });
}

function formatSignedAt(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(value);
}

async function getAgreementByToken(token: string): Promise<AgreementRecord | null> {
  return prisma.venueAgreement.findUnique({
    where: { token },
    select: {
      contentMd: true,
      status: true,
      signerName: true,
      signerEmail: true,
      signerTitle: true,
      signatureSvg: true,
      signedAt: true,
      aisaSignedAt: true,
      aisaSignerName: true,
      aisaSignerTitle: true,
      venueEvent: {
        select: {
          title: true,
          date: true,
          organizerName: true,
          contactEmail: true,
          dealType: true,
          rentalFeeCents: true,
          rentalDepositCents: true,
          rentalPaymentUrl: true,
          rentalPaymentStatus: true,
        },
      },
    },
  });
}

export async function generateMetadata({ params }: AgreementPageProps): Promise<Metadata> {
  await params;

  return {
    title: "Venue Agreement",
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function AgreementSigningPage({
  params,
  searchParams,
}: AgreementPageProps) {
  const [{ token }, { paid }] = await Promise.all([params, searchParams]);
  const agreement = await getAgreementByToken(token);

  if (!agreement || agreement.status === "VOID") {
    notFound();
  }

  const isSigned = agreement.status === "SIGNED";
  const organizerFields = isSigned ? [] : extractOrganizerFields(agreement.contentMd);

  // A document without exactly one signature-block marker cannot be signed or
  // displayed honestly, so this throws rather than silently dropping the block.
  const [leadingMd, trailingMd] = splitAgreementMarkdownAtSignatureBlock(agreement.contentMd);
  const leadingHtml = markdownToHtml(previewOrganizerMarkers(leadingMd, organizerFields));
  const trailingHtml = markdownToHtml(previewOrganizerMarkers(trailingMd, organizerFields));

  // Read server-side and inlined as a data URI: the countersignature image is
  // private and must never be reachable through /public or a static route.
  const aisaSignatureDataUri = getAisaSignatureDataUri();
  const { aisaSignedAt, aisaSignerName, aisaSignerTitle } = agreement;
  const paymentUrl = resolvePostSignPaymentUrl(agreement.venueEvent);
  const paymentAmount = formatRentalAmountSummary(
    agreement.venueEvent.rentalFeeCents,
    agreement.venueEvent.rentalDepositCents,
  );

  if (!aisaSignedAt || !aisaSignerName || !aisaSignerTitle) {
    // Countersign details are stamped when the agreement is created, so their
    // absence means the record was not created through a supported path.
    throw new Error(
      `Agreement ${token} is missing ${brand.shortName} countersignature details`,
    );
  }

  // Courtesy prefill only — never gates signing behind auth. A matching hub
  // account just saves the organizer retyping their own name/title.
  const matchedAccount = isSigned
    ? null
    : await prisma.user.findUnique({
        where: { email: agreement.venueEvent.contactEmail },
        select: { name: true, headline: true },
      });

  if (isSigned) {
    const { signerName, signerTitle, signatureSvg, signedAt } = agreement;

    if (!signerName || !signatureSvg || !signedAt) {
      throw new Error(`Signed agreement ${token} is missing organizer signature details`);
    }

    const paymentUrlWithEmail = paymentUrl
      ? withPrefilledEmail(paymentUrl, agreement.signerEmail)
      : null;
    const paymentPendingConfirmation =
      paid === "1" && agreement.venueEvent.rentalPaymentStatus !== "paid";

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
            Venue Agreement
          </p>
          <h1 className="text-3xl font-semibold text-slate-900">{agreement.venueEvent.title}</h1>
          <p className="text-sm text-slate-600">
            Event date:{" "}
            {new Intl.DateTimeFormat("en-US", {
              dateStyle: "long",
              timeZone: "UTC",
            }).format(agreement.venueEvent.date)}
          </p>
        </header>

        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
          <p className="font-semibold">This agreement has been signed.</p>
          <p className="mt-2">
            Signed by {signerName}
            {signerTitle ? `, ${signerTitle}` : ""} on {formatSignedAt(signedAt)}.
          </p>
          {agreement.venueEvent.rentalPaymentStatus === "paid" ? (
            <span className="mt-4 inline-flex rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white">
              Paid
            </span>
          ) : paymentUrlWithEmail && !paymentPendingConfirmation ? (
            <a
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700"
              href={paymentUrlWithEmail}
            >
              {paymentAmount ? `Pay ${paymentAmount}` : "Pay now"}
            </a>
          ) : null}
          {paymentPendingConfirmation ? (
            <p className="mt-3 font-medium">
              Payment received — confirming with Stripe. Refresh this page in a moment.
            </p>
          ) : null}
        </section>

        <article className="prose prose-slate max-w-none rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div dangerouslySetInnerHTML={{ __html: leadingHtml }} />

          <AgreementSignatureBlock
            mode="signed"
            signatureSvg={signatureSvg}
            signerName={signerName}
            signerTitle={signerTitle ?? ""}
            signedAt={signedAt.toISOString()}
            aisaSignatureDataUri={aisaSignatureDataUri}
            aisaSignedAt={aisaSignedAt.toISOString()}
            aisaSignerName={aisaSignerName}
            aisaSignerTitle={aisaSignerTitle}
          />

          <div dangerouslySetInnerHTML={{ __html: trailingHtml }} />
        </article>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
          Venue Agreement
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{agreement.venueEvent.title}</h1>
        <p className="text-sm text-slate-600">
          Event date:{" "}
          {new Intl.DateTimeFormat("en-US", {
            dateStyle: "long",
            timeZone: "UTC",
          }).format(agreement.venueEvent.date)}
        </p>
      </header>

      {paymentUrl ? (
        <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
          {paymentAmount
            ? `After signing you'll be sent to the ${paymentAmount} payment page.`
            : "After signing you'll be sent to the payment page."}
        </section>
      ) : null}

      <AgreementSigningDocument
        token={token}
        leadingHtml={leadingHtml}
        trailingHtml={trailingHtml}
        defaultName={matchedAccount?.name || agreement.venueEvent.organizerName}
        defaultEmail={agreement.venueEvent.contactEmail}
        organizerFields={organizerFields}
        defaultOrganizerFieldValues={
          matchedAccount?.headline ? { signerTitle: matchedAccount.headline } : undefined
        }
        matchedAccountName={matchedAccount?.name ?? null}
        aisaSignatureDataUri={aisaSignatureDataUri}
        aisaSignedAt={aisaSignedAt.toISOString()}
        aisaSignerName={aisaSignerName}
        aisaSignerTitle={aisaSignerTitle}
      />
    </main>
  );
}
