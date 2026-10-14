"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { AgreementVariableSpec } from "@/lib/agreementTemplates";

export interface VenueAgreementSummary {
  id: string;
  status: string;
  templateKey: string;
  token: string;
  signedAt: string | null;
}

type TemplateKey = "paid-rental" | "free-barter" | "revenue-share";

export interface VenueAgreementPanelProps {
  eventId: string;
  dealType: string;
  contactEmail: string;
  latestAgreement: VenueAgreementSummary | null;
  onChanged: () => void;
  variableSpecs: Record<TemplateKey, readonly AgreementVariableSpec[]>;
}

interface VariableRow {
  id: string;
  name: string;
  value: string;
}

interface AgreementSuccessPayload {
  id: string;
  token: string;
  status: string;
  templateKey: string;
  signingUrl: string;
}

interface AgreementErrorPayload {
  error: string;
  id?: string;
  token?: string;
  status?: string;
  templateKey?: string;
  signingUrl?: string;
}

interface SubmissionState {
  kind: "idle" | "success" | "partial" | "error";
  message: string;
  signingUrl: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getDefaultTemplateKey(dealType: string): TemplateKey {
  switch (dealType) {
    case "PAID_RENTAL":
      return "paid-rental";
    case "BARTER":
    case "FREE_PROMO":
      return "free-barter";
    case "REVENUE_SHARE":
      return "revenue-share";
    case "INTERNAL":
      return "paid-rental";
    default:
      return "paid-rental";
  }
}

function createRow(): VariableRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    value: "",
  };
}

function buildSpecValues(specs: readonly AgreementVariableSpec[]): Record<string, string> {
  return specs.reduce<Record<string, string>>((accumulator, spec) => {
    accumulator[spec.key] = spec.defaultValue ?? "";
    return accumulator;
  }, {});
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readAgreementSuccessPayload(value: unknown): AgreementSuccessPayload | null {
  if (!isObject(value)) {
    return null;
  }

  const { id, token, status, templateKey, signingUrl } = value;
  if (
    typeof id === "string" &&
    typeof token === "string" &&
    typeof status === "string" &&
    typeof templateKey === "string" &&
    typeof signingUrl === "string"
  ) {
    return { id, token, status, templateKey, signingUrl };
  }

  return null;
}

function readAgreementErrorPayload(value: unknown): AgreementErrorPayload | null {
  if (!isObject(value) || typeof value.error !== "string") {
    return null;
  }

  const payload: AgreementErrorPayload = { error: value.error };

  if (typeof value.id === "string") {
    payload.id = value.id;
  }
  if (typeof value.token === "string") {
    payload.token = value.token;
  }
  if (typeof value.status === "string") {
    payload.status = value.status;
  }
  if (typeof value.templateKey === "string") {
    payload.templateKey = value.templateKey;
  }
  if (typeof value.signingUrl === "string") {
    payload.signingUrl = value.signingUrl;
  }

  return payload;
}

const FIELD_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200";

function SpecVariableField({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: AgreementVariableSpec;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const fieldId = `agreement-variable-${spec.key}`;

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-900" htmlFor={fieldId}>
        {spec.label}
      </label>

      {spec.kind === "select" ? (
        <select
          id={fieldId}
          className={FIELD_CLASS}
          disabled={disabled}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}

      {spec.kind === "textarea" ? (
        <textarea
          id={fieldId}
          className={FIELD_CLASS}
          disabled={disabled}
          rows={4}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : null}

      {spec.kind === "money" ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">$</span>
          <input
            id={fieldId}
            className={FIELD_CLASS}
            disabled={disabled}
            inputMode="decimal"
            type="text"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </div>
      ) : null}

      {spec.kind === "text" ? (
        <input
          id={fieldId}
          className={FIELD_CLASS}
          disabled={disabled}
          type="text"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : null}

      <p className="text-xs text-slate-500">{spec.key}</p>
    </div>
  );
}

function formatSignedAt(value: string | null): string {
  if (!value) {
    return "not signed yet";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export default function VenueAgreementPanel({
  eventId,
  dealType,
  contactEmail,
  latestAgreement,
  onChanged,
  variableSpecs,
}: VenueAgreementPanelProps) {
  const internalEvent = dealType === "INTERNAL";
  const defaultTemplateKey = useMemo(() => getDefaultTemplateKey(dealType), [dealType]);
  const [templateKey, setTemplateKey] = useState<TemplateKey>(defaultTemplateKey);
  const specs = variableSpecs[templateKey];
  const [specValues, setSpecValues] = useState<Record<string, string>>(() =>
    buildSpecValues(variableSpecs[defaultTemplateKey]),
  );
  const [rows, setRows] = useState<VariableRow[]>([]);
  const [send, setSend] = useState<boolean>(true);
  const [signerEmail, setSignerEmail] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [copyMessage, setCopyMessage] = useState<string>("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>({
    kind: "idle",
    message: "",
    signingUrl: "",
  });
  const signingUrlInputRef = useRef<HTMLInputElement | null>(null);
  const signerEmailId = useId();

  useEffect(() => {
    setTemplateKey(defaultTemplateKey);
  }, [defaultTemplateKey]);

  // Switching templates swaps the whole variable set, so stale values from the
  // previous template must not survive into the new one.
  useEffect(() => {
    setSpecValues(buildSpecValues(variableSpecs[templateKey]));
    setRows([]);
  }, [templateKey, variableSpecs]);

  const normalizedVariables = useMemo<Record<string, string>>(() => {
    const merged: Record<string, string> = {};

    for (const spec of specs) {
      const value = specValues[spec.key]?.trim() ?? "";
      // Blank values are omitted so the server renders them as a visible blank
      // or, for organizer-fillable keys, an [[organizer:key]] marker.
      if (value) {
        merged[spec.key] = value;
      }
    }

    for (const row of rows) {
      const name = row.name.trim();
      const value = row.value.trim();
      if (!name || !value) {
        continue;
      }

      merged[name] = value;
    }

    return merged;
  }, [rows, specValues, specs]);

  const adminSpecs = useMemo(
    () => specs.filter((spec) => !spec.organizerFillable),
    [specs],
  );
  const organizerSpecs = useMemo(
    () => specs.filter((spec) => spec.organizerFillable === true),
    [specs],
  );

  const updateSpecValue = (key: string, value: string): void => {
    setSpecValues((currentValues) => ({ ...currentValues, [key]: value }));
  };

  const emailError =
    signerEmail.trim() && !EMAIL_PATTERN.test(signerEmail.trim())
      ? "Enter a valid signer email address or leave it blank."
      : "";

  const addRow = (): void => {
    setRows((currentRows) => [...currentRows, createRow()]);
  };

  const updateRow = (rowId: string, field: "name" | "value", value: string): void => {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
  };

  const removeRow = (rowId: string): void => {
    setRows((currentRows) => currentRows.filter((row) => row.id !== rowId));
  };

  const copySigningUrl = async (): Promise<void> => {
    if (!submissionState.signingUrl) {
      return;
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(submissionState.signingUrl);
        setCopyMessage("Signing link copied.");
        return;
      } catch {
        // Fall back to selecting the input when clipboard permissions fail.
      }
    }

    if (signingUrlInputRef.current) {
      signingUrlInputRef.current.focus();
      signingUrlInputRef.current.select();
      setCopyMessage("Signing link selected. Copy it manually.");
      return;
    }

    setCopyMessage("Copy the signing link manually.");
  };

  const handleSubmit = async (): Promise<void> => {
    if (internalEvent || isSubmitting) {
      return;
    }

    if (emailError) {
      setSubmissionState({
        kind: "error",
        message: emailError,
        signingUrl: "",
      });
      return;
    }

    setIsSubmitting(true);
    setCopyMessage("");
    setSubmissionState({
      kind: "idle",
      message: "",
      signingUrl: "",
    });

    try {
      const response = await fetch(`/api/admin/venue-events/${eventId}/agreement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          templateKey,
          variables: normalizedVariables,
          send,
          signerEmail: signerEmail.trim() || undefined,
        }),
      });

      let payload: unknown = null;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        payload = null;
      }

      if (response.ok) {
        const successPayload = readAgreementSuccessPayload(payload);
        if (!successPayload) {
          setSubmissionState({
            kind: "error",
            message: "Agreement was created, but the server returned an unexpected response.",
            signingUrl: "",
          });
          return;
        }

        setSubmissionState({
          kind: "success",
          message: "Agreement created successfully.",
          signingUrl: successPayload.signingUrl,
        });
        onChanged();
        return;
      }

      const errorPayload = readAgreementErrorPayload(payload);
      const errorMessage = errorPayload?.error || "The agreement could not be created.";
      const fallbackSigningUrl =
        errorPayload?.signingUrl ||
        (errorPayload?.token ? `/agreements/${errorPayload.token}` : "");

      if (response.status === 502) {
        setSubmissionState({
          kind: "partial",
          message: `${errorMessage} The agreement exists and may need to be sent manually.`,
          signingUrl: fallbackSigningUrl,
        });
        onChanged();
        return;
      }

      setSubmissionState({
        kind: "error",
        message: errorMessage,
        signingUrl: "",
      });
    } catch {
      setSubmissionState({
        kind: "error",
        message: "Network error while creating the agreement. Please try again.",
        signingUrl: "",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-slate-900">Venue agreement</h2>
        <p className="text-sm text-slate-600">
          The signing link is the only link the organizer needs; payment follows signing.
        </p>
      </div>

      {latestAgreement ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="flex flex-col gap-1">
            <p>
              <span className="font-medium text-slate-900">Status:</span> {latestAgreement.status}
            </p>
            <p>
              <span className="font-medium text-slate-900">Template:</span>{" "}
              {latestAgreement.templateKey}
            </p>
            <p>
              <span className="font-medium text-slate-900">Signed:</span>{" "}
              {formatSignedAt(latestAgreement.signedAt)}
            </p>
            <a
              className="text-sky-700 underline underline-offset-2"
              href={`/agreements/${latestAgreement.token}`}
              target="_blank"
              rel="noreferrer"
            >
              Open latest agreement
            </a>
          </div>
        </div>
      ) : null}

      {internalEvent ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Internal events do not use a venue agreement template. The form is disabled for this
          deal type.
        </div>
      ) : null}

      <div
        className={`mt-4 space-y-4 ${internalEvent ? "pointer-events-none opacity-60" : ""}`}
        aria-disabled={internalEvent}
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-900" htmlFor="agreement-template">
            Template
          </label>
          <select
            id="agreement-template"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            disabled={internalEvent || isSubmitting}
            value={templateKey}
            onChange={(event) => {
              setTemplateKey(event.target.value as TemplateKey);
            }}
          >
            <option value="paid-rental">paid-rental</option>
            <option value="free-barter">free-barter</option>
            <option value="revenue-share">revenue-share</option>
          </select>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium text-slate-900">Template variables</h3>
            <p className="text-xs text-slate-500">
              Prefilled from the template. Anything left blank is rendered as a blank line
              in the agreement.
            </p>
          </div>

          <div className="space-y-4">
            {adminSpecs.map((spec) => (
              <SpecVariableField
                key={spec.key}
                disabled={internalEvent || isSubmitting}
                spec={spec}
                value={specValues[spec.key] ?? ""}
                onChange={(value) => {
                  updateSpecValue(spec.key, value);
                }}
              />
            ))}
          </div>
        </div>

        {organizerSpecs.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
            <div>
              <h3 className="text-sm font-medium text-slate-900">Left for organizer</h3>
              <p className="text-xs text-slate-600">
                The organizer fills these when signing. Enter a value here to override.
              </p>
            </div>

            <div className="space-y-4">
              {organizerSpecs.map((spec) => (
                <SpecVariableField
                  key={spec.key}
                  disabled={internalEvent || isSubmitting}
                  spec={spec}
                  value={specValues[spec.key] ?? ""}
                  onChange={(value) => {
                    updateSpecValue(spec.key, value);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-900">Extra variables</h3>
              <p className="text-xs text-slate-500">
                Optional key/value pairs for keys not in the template. Rows without a name
                or value are ignored.
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={internalEvent || isSubmitting}
              onClick={addRow}
            >
              Add variable
            </button>
          </div>

          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                  disabled={internalEvent || isSubmitting}
                  placeholder={`variable-${index + 1}`}
                  type="text"
                  value={row.name}
                  onChange={(event) => {
                    updateRow(row.id, "name", event.target.value);
                  }}
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                  disabled={internalEvent || isSubmitting}
                  placeholder="Value"
                  type="text"
                  value={row.value}
                  onChange={(event) => {
                    updateRow(row.id, "value", event.target.value);
                  }}
                />
                <button
                  type="button"
                  className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={internalEvent || isSubmitting}
                  onClick={() => {
                    removeRow(row.id);
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          <label className="flex items-center gap-3 text-sm text-slate-800">
            <input
              checked={send}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              disabled={internalEvent || isSubmitting}
              type="checkbox"
              onChange={(event) => {
                setSend(event.target.checked);
              }}
            />
            Send to organizer
          </label>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-900" htmlFor={signerEmailId}>
              Signer email
            </label>
            <input
              id={signerEmailId}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              disabled={internalEvent || isSubmitting}
              placeholder={contactEmail}
              type="email"
              value={signerEmail}
              onChange={(event) => {
                setSignerEmail(event.target.value);
              }}
            />
            {emailError ? (
              <p className="text-sm text-rose-700" role="alert">
                {emailError}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={internalEvent || isSubmitting}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {isSubmitting ? "Creating agreement..." : "Create agreement"}
          </button>

          {submissionState.kind === "error" ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              {submissionState.message}
            </div>
          ) : null}

          {submissionState.kind === "partial" ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              <p>{submissionState.message}</p>
              {submissionState.signingUrl ? (
                <a
                  className="mt-2 inline-block text-amber-950 underline underline-offset-2"
                  href={submissionState.signingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open signing link
                </a>
              ) : null}
            </div>
          ) : null}

          {(submissionState.kind === "success" || submissionState.kind === "partial") &&
          submissionState.signingUrl ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm text-emerald-900">
                {submissionState.kind === "success"
                  ? submissionState.message
                  : "Use this signing link to send the agreement manually."}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  ref={signingUrlInputRef}
                  readOnly
                  className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900"
                  type="text"
                  value={submissionState.signingUrl}
                />
                <button
                  type="button"
                  className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:border-emerald-400"
                  onClick={() => {
                    void copySigningUrl();
                  }}
                >
                  Copy link
                </button>
              </div>
              {copyMessage ? <p className="mt-2 text-sm text-emerald-900">{copyMessage}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
