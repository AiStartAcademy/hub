"use client";

import { useEffect, useState } from "react";

import AgreementSignatureBlock from "@/components/venue/AgreementSignatureBlock";

export interface OrganizerFillableField {
  key: string;
  label: string;
}

type AgreementSigningDocumentProps = {
  token: string;
  /** Server-rendered markdown HTML before the signature block. Escaped upstream by markdownToHtml. */
  leadingHtml: string;
  /** Server-rendered markdown HTML after the signature block. */
  trailingHtml: string;
  defaultName: string;
  defaultEmail: string;
  /** Unfilled `[[organizer:key]]` markers left in the agreement — collected at signing. */
  organizerFields: OrganizerFillableField[];
  /** Courtesy prefill for organizer fields sourced from a matched hub account. */
  defaultOrganizerFieldValues?: Record<string, string>;
  /** Name of a matched hub account, shown as a non-blocking recognition note. Does not gate signing. */
  matchedAccountName?: string | null;
  aisaSignatureDataUri: string;
  aisaSignedAt: string;
  aisaSignerName: string;
  aisaSignerTitle: string;
};

type FormErrors = {
  signerName?: string;
  signerEmail?: string;
  signatureText?: string;
  agreed?: string;
  form?: string;
} & Record<string, string | undefined>;

type SignAgreementResponse = {
  ok?: boolean;
  signedAt?: string;
  paymentUrl?: string | null;
  error?: string;
};

type SignSuccess = {
  signedAt: string;
  paymentUrl: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildInitialFieldValues(
  fields: OrganizerFillableField[],
  defaultEmail: string,
  prefilled: Record<string, string>,
): Record<string, string> {
  return fields.reduce<Record<string, string>>((accumulator, field) => {
    if (prefilled[field.key]) {
      accumulator[field.key] = prefilled[field.key];
      return accumulator;
    }
    // contactEmail is nearly always the same as the signer's own email — start
    // there, but the input stays independently editable.
    accumulator[field.key] = field.key === "contactEmail" ? defaultEmail : "";
    return accumulator;
  }, {});
}

export default function AgreementSigningDocument({
  token,
  leadingHtml,
  trailingHtml,
  defaultName,
  defaultEmail,
  organizerFields,
  defaultOrganizerFieldValues,
  matchedAccountName,
  aisaSignatureDataUri,
  aisaSignedAt,
  aisaSignerName,
  aisaSignerTitle,
}: AgreementSigningDocumentProps) {
  const [signerName, setSignerName] = useState(defaultName);
  const [signerEmail, setSignerEmail] = useState(defaultEmail);
  const [signatureText, setSignatureText] = useState(defaultName);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    buildInitialFieldValues(organizerFields, defaultEmail, defaultOrganizerFieldValues ?? {}),
  );
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<SignSuccess | null>(null);

  useEffect(() => {
    if (!success?.paymentUrl) {
      return;
    }

    const paymentUrl = success.paymentUrl;
    const timeoutId = window.setTimeout(() => {
      window.location.assign(paymentUrl);
    }, 1_500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [success]);

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};

    if (signerName.trim().length === 0) {
      nextErrors.signerName = "Enter your full name.";
    }

    if (signerEmail.trim().length === 0) {
      nextErrors.signerEmail = "Enter your email address.";
    } else if (!EMAIL_PATTERN.test(signerEmail.trim())) {
      nextErrors.signerEmail = "Enter a valid email address.";
    }

    // Non-empty is the whole bar: signers legitimately use variants of their
    // name (middle initial, nickname), so a mismatch with signerName is allowed.
    if (signatureText.trim().length === 0) {
      nextErrors.signatureText = "Type your name to sign.";
    }

    for (const field of organizerFields) {
      if ((fieldValues[field.key] ?? "").trim().length === 0) {
        nextErrors[field.key] = `Enter ${field.label.toLowerCase()}.`;
      }
    }

    if (!agreed) {
      nextErrors.agreed =
        "You must confirm that you have read and agree to this agreement before signing.";
    }

    return nextErrors;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const nextErrors = validate();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/agreements/${token}/sign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerEmail: signerEmail.trim(),
          signerTitle: (fieldValues.signerTitle ?? "").trim(),
          signatureText: signatureText.trim(),
          organizerFieldValues: Object.fromEntries(
            organizerFields.map((field) => [field.key, (fieldValues[field.key] ?? "").trim()]),
          ),
          agreed: true,
        }),
      });

      const payload: SignAgreementResponse = await response.json();

      if (!response.ok || payload.ok !== true || typeof payload.signedAt !== "string") {
        setErrors({
          form: payload.error ?? "Unable to sign the agreement right now. Please try again.",
        });
        return;
      }

      setSuccess({
        signedAt: payload.signedAt,
        paymentUrl: typeof payload.paymentUrl === "string" ? payload.paymentUrl : null,
      });
      setErrors({});
    } catch {
      setErrors({
        form: "A network error interrupted the request. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    if (success.paymentUrl) {
      return (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
          <p className="font-semibold">Agreement signed. Taking you to payment…</p>
          <p className="mt-2">
            If you are not redirected automatically,{" "}
            <a
              className="font-semibold underline underline-offset-2"
              href={success.paymentUrl}
            >
              Pay now
            </a>
            .
          </p>
        </section>
      );
    }

    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
        <p className="font-semibold">Agreement signed successfully.</p>
        <p className="mt-2">
          Signed on{" "}
          {new Intl.DateTimeFormat("en-US", {
            dateStyle: "long",
            timeStyle: "short",
          }).format(new Date(success.signedAt))}
          . A copy has been emailed.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div className="space-y-4">
          {matchedAccountName ? (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Matched hub account: {matchedAccountName}. Fields below are prefilled — edit anything
              that&apos;s wrong.
            </p>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="signerName">
              Full name *
            </label>
            <input
              id="signerName"
              name="signerName"
              type="text"
              autoComplete="name"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              aria-invalid={errors.signerName ? "true" : "false"}
              aria-describedby={errors.signerName ? "signerName-error" : undefined}
            />
            {errors.signerName ? (
              <p id="signerName-error" role="alert" className="mt-1 text-sm text-rose-700">
                {errors.signerName}
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="signerEmail">
              Email *
            </label>
            <input
              id="signerEmail"
              name="signerEmail"
              type="email"
              autoComplete="email"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              value={signerEmail}
              onChange={(event) => setSignerEmail(event.target.value)}
              aria-invalid={errors.signerEmail ? "true" : "false"}
              aria-describedby={errors.signerEmail ? "signerEmail-error" : undefined}
            />
            {errors.signerEmail ? (
              <p id="signerEmail-error" role="alert" className="mt-1 text-sm text-rose-700">
                {errors.signerEmail}
              </p>
            ) : null}
          </div>

          {organizerFields.map((field) => (
            <div key={field.key}>
              <label
                className="mb-1 block text-sm font-medium text-slate-900"
                htmlFor={`organizer-${field.key}`}
              >
                {field.label} *
              </label>
              <input
                id={`organizer-${field.key}`}
                name={field.key}
                type={field.key === "contactEmail" ? "email" : "text"}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
                value={fieldValues[field.key] ?? ""}
                onChange={(event) =>
                  setFieldValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
                aria-invalid={errors[field.key] ? "true" : "false"}
                aria-describedby={errors[field.key] ? `organizer-${field.key}-error` : undefined}
              />
              {errors[field.key] ? (
                <p
                  id={`organizer-${field.key}-error`}
                  role="alert"
                  className="mt-1 text-sm text-rose-700"
                >
                  {errors[field.key]}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <article className="prose prose-slate mt-8 max-w-none rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {/* markdownToHtml escapes all HTML before formatting, so these strings carry no caller markup. */}
        <div dangerouslySetInnerHTML={{ __html: leadingHtml }} />

        <AgreementSignatureBlock
          mode="editable"
          signatureText={signatureText}
          signerName={signerName}
          signerTitle={fieldValues.signerTitle ?? ""}
          signatureTextError={errors.signatureText}
          onSignatureTextChange={setSignatureText}
          aisaSignatureDataUri={aisaSignatureDataUri}
          aisaSignedAt={aisaSignedAt}
          aisaSignerName={aisaSignerName}
          aisaSignerTitle={aisaSignerTitle}
        />

        <div dangerouslySetInnerHTML={{ __html: trailingHtml }} />
      </article>

      <div className="sticky bottom-0 z-10 mt-8 rounded-t-2xl border-t border-slate-300 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur sm:px-6">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <input
              id="agreed"
              name="agreed"
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              aria-invalid={errors.agreed ? "true" : "false"}
              aria-describedby={errors.agreed ? "agreed-error" : undefined}
            />
            <label className="text-sm text-slate-700" htmlFor="agreed">
              I have read and agree to this agreement, and I intend my typed name to be my
              signature.
            </label>
          </div>
          {errors.agreed ? (
            <p id="agreed-error" role="alert" className="text-sm text-rose-700">
              {errors.agreed}
            </p>
          ) : null}

          {errors.form ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {errors.form}
            </p>
          ) : null}

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing..." : "Sign agreement"}
          </button>
        </div>
      </div>
    </form>
  );
}
