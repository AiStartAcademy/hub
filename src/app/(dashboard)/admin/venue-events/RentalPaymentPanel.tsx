"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface RentalPaymentPanelProps {
  eventId: string;
  dealType: string;
  rentalFeeCents: number | null;
  rentalDepositCents: number | null;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
  quoteAmountCents: number | null;
  onChanged: () => void;
}

interface RentalPaymentSuccessPayload {
  rentalFeeCents: number | null;
  rentalDepositCents: number | null;
  rentalPaymentLinkId: string | null;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
}

interface RentalPaymentErrorPayload {
  error: string;
}

interface SubmissionState {
  kind: "idle" | "success" | "error";
  message: string;
}

interface CurrentPaymentState {
  rentalFeeCents: number | null;
  rentalDepositCents: number | null;
  rentalPaymentUrl: string | null;
  rentalPaymentStatus: string | null;
}

const FIELD_CLASS =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200";

function formatDollarsFromCents(value: number | null): string {
  if (value == null) {
    return "";
  }

  return (value / 100).toFixed(2);
}

function formatCurrency(value: number | null): string {
  if (value == null) {
    return "$0.00";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

function getStatusLabel(status: string | null): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "refunded":
      return "Refunded";
    case "pending":
    default:
      return "Pending";
  }
}

function getStatusBadgeClass(status: string | null): string {
  switch (status) {
    case "paid":
      return "bg-emerald-100 text-emerald-800";
    case "refunded":
      return "bg-slate-200 text-slate-800";
    case "pending":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRentalPaymentSuccessPayload(
  value: unknown,
): RentalPaymentSuccessPayload | null {
  if (!isObject(value)) {
    return null;
  }

  const {
    rentalFeeCents,
    rentalDepositCents,
    rentalPaymentLinkId,
    rentalPaymentUrl,
    rentalPaymentStatus,
  } = value;

  if (
    (rentalFeeCents === null || typeof rentalFeeCents === "number") &&
    (rentalDepositCents === null || typeof rentalDepositCents === "number") &&
    (rentalPaymentLinkId === null || typeof rentalPaymentLinkId === "string") &&
    (rentalPaymentUrl === null || typeof rentalPaymentUrl === "string") &&
    (rentalPaymentStatus === null || typeof rentalPaymentStatus === "string")
  ) {
    return {
      rentalFeeCents,
      rentalDepositCents,
      rentalPaymentLinkId,
      rentalPaymentUrl,
      rentalPaymentStatus,
    };
  }

  return null;
}

function readRentalPaymentErrorPayload(
  value: unknown,
): RentalPaymentErrorPayload | null {
  if (!isObject(value) || typeof value.error !== "string") {
    return null;
  }

  return { error: value.error };
}

function parseCurrencyInput(
  value: string,
  fieldLabel: "Fee" | "Deposit",
): { cents: number | null; error: string } {
  const trimmed = value.trim();

  if (trimmed === "") {
    if (fieldLabel === "Fee") {
      return { cents: null, error: "Fee is required." };
    }

    return { cents: 0, error: "" };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return {
      cents: null,
      error: `${fieldLabel} must be a valid non-negative dollar amount.`,
    };
  }

  if (parsed < 0) {
    return {
      cents: null,
      error: `${fieldLabel} must be a valid non-negative dollar amount.`,
    };
  }

  return { cents: Math.round(parsed * 100), error: "" };
}

export default function RentalPaymentPanel({
  eventId,
  dealType,
  rentalFeeCents,
  rentalDepositCents,
  rentalPaymentUrl,
  rentalPaymentStatus,
  quoteAmountCents,
  onChanged,
}: RentalPaymentPanelProps) {
  const feeInputId = useId();
  const depositInputId = useId();
  const paymentUrlInputId = useId();
  const paymentUrlInputRef = useRef<HTMLInputElement | null>(null);
  const [currentPayment, setCurrentPayment] = useState<CurrentPaymentState>({
    rentalFeeCents,
    rentalDepositCents,
    rentalPaymentUrl,
    rentalPaymentStatus,
  });
  const [feeAmount, setFeeAmount] = useState<string>(() =>
    formatDollarsFromCents(rentalFeeCents ?? quoteAmountCents),
  );
  const [depositAmount, setDepositAmount] = useState<string>(() =>
    formatDollarsFromCents(rentalDepositCents),
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<"create" | "deactivate" | null>(
    null,
  );
  const [copyMessage, setCopyMessage] = useState<string>("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>({
    kind: "idle",
    message: "",
  });

  useEffect(() => {
    setCurrentPayment({
      rentalFeeCents,
      rentalDepositCents,
      rentalPaymentUrl,
      rentalPaymentStatus,
    });
    setFeeAmount(formatDollarsFromCents(rentalFeeCents ?? quoteAmountCents));
    setDepositAmount(formatDollarsFromCents(rentalDepositCents));
    setCopyMessage("");
    setSubmissionState({ kind: "idle", message: "" });
  }, [
    eventId,
    quoteAmountCents,
    rentalDepositCents,
    rentalFeeCents,
    rentalPaymentStatus,
    rentalPaymentUrl,
  ]);

  const hasLink = Boolean(currentPayment.rentalPaymentUrl);
  const isPaid = currentPayment.rentalPaymentStatus === "paid";
  const nonRentalDeal = dealType !== "PAID_RENTAL";

  const copyPaymentUrl = async (): Promise<void> => {
    if (!currentPayment.rentalPaymentUrl) {
      return;
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(currentPayment.rentalPaymentUrl);
        setCopyMessage("Payment link copied.");
        return;
      } catch {
        if (paymentUrlInputRef.current) {
          paymentUrlInputRef.current.focus();
          paymentUrlInputRef.current.select();
          setCopyMessage("Clipboard is unavailable here. Copy the selected link manually.");
          return;
        }

        setCopyMessage("Clipboard is unavailable here. Copy the payment link manually.");
        return;
      }
    }

    if (paymentUrlInputRef.current) {
      paymentUrlInputRef.current.focus();
      paymentUrlInputRef.current.select();
      setCopyMessage("Clipboard is unavailable here. Copy the selected link manually.");
      return;
    }

    setCopyMessage("Clipboard is unavailable here. Copy the payment link manually.");
  };

  const handleCreate = async (): Promise<void> => {
    if (nonRentalDeal || hasLink || isSubmitting) {
      return;
    }

    const parsedFee = parseCurrencyInput(feeAmount, "Fee");
    if (parsedFee.error) {
      setSubmissionState({ kind: "error", message: parsedFee.error });
      return;
    }

    const parsedDeposit = parseCurrencyInput(depositAmount, "Deposit");
    if (parsedDeposit.error) {
      setSubmissionState({ kind: "error", message: parsedDeposit.error });
      return;
    }

    setIsSubmitting(true);
    setPendingAction("create");
    setCopyMessage("");
    setSubmissionState({ kind: "idle", message: "" });

    try {
      const response = await fetch(`/api/admin/venue-events/${eventId}/rental-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feeCents: parsedFee.cents,
          depositCents: parsedDeposit.cents,
        }),
      });

      let payload: unknown = null;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const errorPayload = readRentalPaymentErrorPayload(payload);
        setSubmissionState({
          kind: "error",
          message:
            errorPayload?.error ??
            "The rental payment link could not be created because the server returned an unexpected response.",
        });
        return;
      }

      const successPayload = readRentalPaymentSuccessPayload(payload);

      if (!successPayload) {
        setSubmissionState({
          kind: "error",
          message:
            "Rental payment link was created, but the server returned an unexpected response.",
        });
        return;
      }

      setCurrentPayment({
        rentalFeeCents: successPayload.rentalFeeCents,
        rentalDepositCents: successPayload.rentalDepositCents,
        rentalPaymentUrl: successPayload.rentalPaymentUrl,
        rentalPaymentStatus: successPayload.rentalPaymentStatus,
      });
      setFeeAmount(formatDollarsFromCents(successPayload.rentalFeeCents));
      setDepositAmount(formatDollarsFromCents(successPayload.rentalDepositCents));
      setSubmissionState({
        kind: "success",
        message: "Rental payment link created successfully.",
      });
      onChanged();
    } catch {
      setSubmissionState({
        kind: "error",
        message: "Network error while creating the rental payment link. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
      setPendingAction(null);
    }
  };

  const handleDeactivate = async (): Promise<void> => {
    if (!hasLink || isPaid || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setPendingAction("deactivate");
    setCopyMessage("");
    setSubmissionState({ kind: "idle", message: "" });

    try {
      const response = await fetch(`/api/admin/venue-events/${eventId}/rental-payment`, {
        method: "DELETE",
      });

      let payload: unknown = null;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const errorPayload = readRentalPaymentErrorPayload(payload);
        setSubmissionState({
          kind: "error",
          message:
            errorPayload?.error ??
            "The rental payment link could not be deactivated because the server returned an unexpected response.",
        });
        return;
      }

      const successPayload = readRentalPaymentSuccessPayload(payload);

      if (!successPayload) {
        setSubmissionState({
          kind: "error",
          message:
            "Rental payment link was deactivated, but the server returned an unexpected response.",
        });
        return;
      }

      setCurrentPayment({
        rentalFeeCents: successPayload.rentalFeeCents,
        rentalDepositCents: successPayload.rentalDepositCents,
        rentalPaymentUrl: successPayload.rentalPaymentUrl,
        rentalPaymentStatus: successPayload.rentalPaymentStatus,
      });
      setFeeAmount(formatDollarsFromCents(quoteAmountCents));
      setDepositAmount("");
      setSubmissionState({
        kind: "success",
        message: "Rental payment link deactivated. You can issue a new link now.",
      });
      onChanged();
    } catch {
      setSubmissionState({
        kind: "error",
        message: "Network error while deactivating the rental payment link. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
      setPendingAction(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-slate-900">Rental payment</h2>
        <p className="text-sm text-slate-600">
          Create the agreement first so the organizer is sent to this payment page after signing
          and returned to the agreement after payment.
        </p>
      </div>

      {submissionState.kind === "error" ? (
        <div
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {submissionState.message}
        </div>
      ) : null}

      {submissionState.kind === "success" ? (
        <div
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          role="status"
        >
          {submissionState.message}
        </div>
      ) : null}

      {nonRentalDeal ? (
        <p className="mt-4 text-sm text-slate-600">
          This deal type does not take a rental payment.
        </p>
      ) : null}

      {!nonRentalDeal && !hasLink ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">Fee (USD)</span>
              <input
                id={feeInputId}
                className={FIELD_CLASS}
                disabled={isSubmitting}
                inputMode="decimal"
                onChange={(event) => {
                  setFeeAmount(event.target.value);
                }}
                placeholder="0.00"
                step="0.01"
                type="number"
                value={feeAmount}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">
                Deposit (USD)
              </span>
              <input
                id={depositInputId}
                className={FIELD_CLASS}
                disabled={isSubmitting}
                inputMode="decimal"
                onChange={(event) => {
                  setDepositAmount(event.target.value);
                }}
                placeholder="0.00"
                step="0.01"
                type="number"
                value={depositAmount}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              onClick={() => {
                void handleCreate();
              }}
              type="button"
            >
              {pendingAction === "create" ? "Creating..." : "Create payment link"}
            </button>

            <p className="text-sm text-slate-500">
              Fee defaults from the quote amount when no rental fee is saved yet.
            </p>
          </div>
        </div>
      ) : null}

      {!nonRentalDeal && hasLink ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={[
                  "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                  getStatusBadgeClass(currentPayment.rentalPaymentStatus),
                ].join(" ")}
              >
                {getStatusLabel(currentPayment.rentalPaymentStatus)}
              </span>
              <span>
                Fee:{" "}
                <span className="font-medium text-slate-900">
                  {formatCurrency(currentPayment.rentalFeeCents)}
                </span>
              </span>
              <span>
                Deposit:{" "}
                <span className="font-medium text-slate-900">
                  {formatCurrency(currentPayment.rentalDepositCents)}
                </span>
              </span>
            </div>

            <div className="mt-4 space-y-2">
              <label
                className="block text-sm font-medium text-slate-900"
                htmlFor={paymentUrlInputId}
              >
                Payment link
              </label>
              <input
                ref={paymentUrlInputRef}
                readOnly
                className={FIELD_CLASS}
                id={paymentUrlInputId}
                value={currentPayment.rentalPaymentUrl ?? ""}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                onClick={() => {
                  void copyPaymentUrl();
                }}
                type="button"
              >
                Copy
              </button>

              {!isPaid ? (
                <button
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting}
                  onClick={() => {
                    void handleDeactivate();
                  }}
                  type="button"
                >
                  {pendingAction === "deactivate"
                    ? "Deactivating..."
                    : "Deactivate & re-issue"}
                </button>
              ) : null}
            </div>

            {copyMessage ? (
              <p className="mt-3 text-sm text-slate-600">{copyMessage}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
