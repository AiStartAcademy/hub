"use client";

import { brand } from "@/config/brand";

type BaseSignatureBlockProps = {
  aisaSignatureDataUri: string;
  aisaSignedAt: string;
  aisaSignerName: string;
  aisaSignerTitle: string;
};

type EditableSignatureBlockProps = BaseSignatureBlockProps & {
  mode: "editable";
  signatureText: string;
  signerName: string;
  signerTitle: string;
  signatureTextError?: string;
  onSignatureTextChange: (value: string) => void;
};

type SignedSignatureBlockProps = BaseSignatureBlockProps & {
  mode: "signed";
  signatureSvg: string;
  signerName: string;
  signerTitle: string;
  signedAt: string;
};

export type AgreementSignatureBlockProps =
  | EditableSignatureBlockProps
  | SignedSignatureBlockProps;

const PENDING_DATE_LABEL = "\u2014";
const PENDING_SIGNATURE_DATE_LABEL = "(generated upon signing)";
const SIGNATURE_TEXT_NOTE_ID = "signatureText-note";
const SIGNATURE_TEXT_ERROR_ID = "signatureText-error";

function formatSignatureDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
  }).format(new Date(value));
}

function formatSignerValue(value: string): string {
  return value.trim().length > 0 ? value.trim() : PENDING_DATE_LABEL;
}

export default function AgreementSignatureBlock(props: AgreementSignatureBlockProps) {
  const signatureTextDescribedBy = [
    SIGNATURE_TEXT_NOTE_ID,
    props.mode === "editable" && props.signatureTextError ? SIGNATURE_TEXT_ERROR_ID : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="my-8 rounded-2xl border border-slate-300 bg-slate-50 p-5 shadow-sm sm:p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Organizer signature
          </p>
          {props.mode === "editable" ? (
            <div className="mt-4">
              <label
                className="mb-1 block text-sm font-medium text-slate-900"
                htmlFor="signatureText"
              >
                Type your full name
              </label>
              <input
                id="signatureText"
                name="signatureText"
                type="text"
                autoComplete="name"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                value={props.signatureText}
                onChange={(event) => props.onSignatureTextChange(event.target.value)}
                aria-invalid={props.signatureTextError ? "true" : "false"}
                aria-describedby={signatureTextDescribedBy}
              />
              <p id={SIGNATURE_TEXT_NOTE_ID} className="mt-1 text-xs text-slate-500">
                Your typed signature can differ from the full name entered above.
              </p>
              {props.signatureTextError ? (
                <p id={SIGNATURE_TEXT_ERROR_ID} role="alert" className="mt-1 text-sm text-rose-700">
                  {props.signatureTextError}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
            <div className="flex min-h-20 items-end overflow-x-auto">
              {props.mode === "signed" ? (
                <div
                  className="max-w-full"
                  // Trusted because signatureSvg is persisted from renderTypedSignatureSvg(),
                  // the server-generated typed-signature artifact, not arbitrary user HTML.
                  dangerouslySetInnerHTML={{ __html: props.signatureSvg }}
                />
              ) : props.signatureText.trim().length > 0 ? (
                <p className="signature-script text-4xl font-semibold italic leading-none text-slate-900">
                  {props.signatureText.trim()}
                </p>
              ) : (
                <p className="text-3xl leading-none text-slate-300">{PENDING_DATE_LABEL}</p>
              )}
            </div>
          </div>

          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="text-slate-500">Name</dt>
              <dd className="text-right font-medium text-slate-900">
                {props.mode === "signed" ? props.signerName : formatSignerValue(props.signerName)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="text-slate-500">Title</dt>
              <dd className="text-right font-medium text-slate-900">
                {props.mode === "signed" ? props.signerTitle : formatSignerValue(props.signerTitle)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-slate-500">Date</dt>
              <dd className="text-right font-medium text-slate-900">
                {props.mode === "signed"
                  ? formatSignatureDate(props.signedAt)
                  : PENDING_SIGNATURE_DATE_LABEL}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {brand.name} countersignature
          </p>
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
            <div className="flex min-h-20 items-end">
              <img
                src={props.aisaSignatureDataUri}
                alt={`${props.aisaSignerName} signature`}
                className="max-h-20 w-auto"
              />
            </div>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="text-slate-500">Name</dt>
              <dd className="text-right font-medium text-slate-900">{props.aisaSignerName}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2">
              <dt className="text-slate-500">Title</dt>
              <dd className="text-right font-medium text-slate-900">{props.aisaSignerTitle}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-slate-500">Date</dt>
              <dd className="text-right font-medium text-slate-900">
                {formatSignatureDate(props.aisaSignedAt)}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
}
