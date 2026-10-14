"use client";

import type { AgreementVariableSpec } from "@/lib/agreementTemplates";
import type {
  AgendaItem,
  EventHost,
  FaqEntry,
  GalleryImage,
  PricingTier,
} from "@/lib/venueEventContent";
import {
  parseAgenda,
  parseFaq,
  parseGallery,
  parseHosts,
  parsePricingTiers,
} from "@/lib/venueEventContent";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { JSX } from "react";

import VenueEventPublicPageSection, {
  EMPTY_PUBLIC_PAGE_VALUE,
} from "./VenueEventPublicPageSection";
import type { PublicPageValue } from "./VenueEventPublicPageSection";
import type { VenueEventRow } from "./VenueEventsClient";
import VenueAgreementPanel from "./VenueAgreementPanel";
import OrganizerEmailPanel from "./OrganizerEmailPanel";
import RentalPaymentPanel from "./RentalPaymentPanel";
import { formatVenueEventTypeLabel } from "@/lib/venueEventTypeLabels";

export interface VenueEventDrawerProps {
  event: VenueEventRow | null;
  onClose: () => void;
  onChanged: () => void;
  variableSpecs: Record<
    "paid-rental" | "free-barter" | "revenue-share",
    readonly AgreementVariableSpec[]
  >;
}

type VenueEventStatus = "APPROVED" | "DECLINED" | "CANCELLED" | "PENDING";
type VenueDealType =
  | "PAID_RENTAL"
  | "BARTER"
  | "REVENUE_SHARE"
  | "FREE_PROMO"
  | "INTERNAL";
type RequestKey = "save" | "approve" | "decline" | "cancel" | "resync";

type PatchPayload = Partial<{
  status: VenueEventStatus;
  adminNote: string;
  dealType: VenueDealType;
  dealNote: string;
  quoteAmountCents: number | null;
  quoteNote: string;
  ticketPriceCents: number | null;
  ticketPaymentLink: string;
  capacity: number | null;
  subtitle: string | null;
  description: string | null;
  cover: string | null;
  videoUrl: string | null;
  priceNote: string | null;
  endDate: string | null;
  gallery: GalleryImage[] | null;
  agenda: AgendaItem[] | null;
  hosts: EventHost[] | null;
  pricingTiers: PricingTier[] | null;
  faq: FaqEntry[] | null;
  sendDeclineEmail: boolean;
  resyncGcal: boolean;
}>;

interface FormState {
  adminNote: string;
  dealType: VenueDealType;
  dealNote: string;
  quoteAmount: string;
  quoteNote: string;
  ticketPrice: string;
  ticketPaymentLink: string;
  capacity: string;
  publicPage: PublicPageValue;
}

interface ParsedNumberResult {
  ok: boolean;
  value: number | null;
}

const DEAL_TYPE_OPTIONS: Array<{ label: string; value: VenueDealType }> = [
  { label: "Paid rental", value: "PAID_RENTAL" },
  { label: "Barter", value: "BARTER" },
  { label: "Revenue share", value: "REVENUE_SHARE" },
  { label: "Free promo", value: "FREE_PROMO" },
  { label: "Internal", value: "INTERNAL" },
];

const EMPTY_FORM_STATE: FormState = {
  adminNote: "",
  dealType: "PAID_RENTAL",
  dealNote: "",
  quoteAmount: "",
  quoteNote: "",
  ticketPrice: "",
  ticketPaymentLink: "",
  capacity: "",
  publicPage: EMPTY_PUBLIC_PAGE_VALUE,
};

function isDealType(value: string | null | undefined): value is VenueDealType {
  return DEAL_TYPE_OPTIONS.some((option) => option.value === value);
}

function seedFormState(event: VenueEventRow): FormState {
  return {
    adminNote: event.adminNote ?? "",
    dealType: isDealType(event.dealType) ? event.dealType : "PAID_RENTAL",
    dealNote: event.dealNote ?? "",
    quoteAmount:
      event.quoteAmountCents == null ? "" : String(event.quoteAmountCents / 100),
    quoteNote: event.quoteNote ?? "",
    ticketPrice:
      event.ticketPriceCents == null ? "" : String(event.ticketPriceCents / 100),
    ticketPaymentLink: event.ticketPaymentLink ?? "",
    capacity: event.capacity == null ? "" : String(event.capacity),
    publicPage: {
      subtitle: event.subtitle ?? "",
      description: event.description ?? "",
      cover: event.cover ?? "",
      videoUrl: event.videoUrl ?? "",
      priceNote: event.priceNote ?? "",
      endDate: event.endDate ? event.endDate.slice(0, 10) : "",
      gallery: parseGallery(event.gallery),
      agenda: parseAgenda(event.agenda),
      hosts: parseHosts(event.hosts),
      pricingTiers: parsePricingTiers(event.pricingTiers),
      faq: parseFaq(event.faq),
    },
  };
}

function formatDateUtc(value: string | null | undefined): string {
  if (!value) {
    return "Not provided";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not provided";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatText(value: string | number | null | undefined): string {
  if (value == null || value === "") {
    return "Not provided";
  }

  return String(value);
}

function parseCurrencyToCents(value: string): ParsedNumberResult {
  const trimmed = value.trim();

  if (trimmed === "") {
    return { ok: true, value: null };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, value: null };
  }

  return { ok: true, value: Math.round(parsed * 100) };
}

function parseCapacity(value: string): ParsedNumberResult {
  const trimmed = value.trim();

  if (trimmed === "") {
    return { ok: true, value: null };
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ok: false, value: null };
  }

  return { ok: true, value: parsed };
}

function arraysDiffer<T>(next: T[], initial: T[]): boolean {
  return JSON.stringify(next) !== JSON.stringify(initial);
}

function ReadOnlyRow(props: { label: string; value: JSX.Element | string }): JSX.Element {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-sm font-medium text-slate-500">{props.label}</dt>
      <dd className="text-sm text-slate-900">{props.value}</dd>
    </div>
  );
}

export default function VenueEventDrawer(
  props: VenueEventDrawerProps,
): JSX.Element | null {
  const { event, onChanged, onClose, variableSpecs } = props;
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM_STATE);
  const [initialFormState, setInitialFormState] = useState<FormState>(EMPTY_FORM_STATE);
  const [declineEmail, setDeclineEmail] = useState<boolean>(false);
  const [requestKey, setRequestKey] = useState<RequestKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!event) {
      return;
    }

    const nextFormState = seedFormState(event);
    setFormState(nextFormState);
    setInitialFormState(nextFormState);
    setDeclineEmail(false);
    setRequestKey(null);
    setErrorMessage(null);
    setNoticeMessage(null);
  }, [event?.id]);

  useEffect(() => {
    if (!event) {
      return;
    }

    const handleKeyDown = (input: KeyboardEvent): void => {
      if (input.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [event, onClose]);

  if (!event) {
    return null;
  }

  const isBusy = requestKey !== null;

  const runPatchRequest = async (
    payload: PatchPayload,
    nextRequestKey: RequestKey,
    successMessage: string,
    onSuccess?: () => void,
  ): Promise<void> => {
    setRequestKey(nextRequestKey);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const response = await fetch(`/api/admin/venue-events/${event.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Request failed.");
      }

      setNoticeMessage(successMessage);
      onSuccess?.();
      onChanged();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Network request failed.",
      );
    } finally {
      setRequestKey(null);
    }
  };

  const handleSave = async (): Promise<void> => {
    const parsedQuoteAmount = parseCurrencyToCents(formState.quoteAmount);
    const parsedInitialQuoteAmount = parseCurrencyToCents(initialFormState.quoteAmount);
    const parsedTicketPrice = parseCurrencyToCents(formState.ticketPrice);
    const parsedInitialTicketPrice = parseCurrencyToCents(initialFormState.ticketPrice);
    const parsedCapacity = parseCapacity(formState.capacity);
    const parsedInitialCapacity = parseCapacity(initialFormState.capacity);

    if (!parsedQuoteAmount.ok) {
      setErrorMessage("Quote amount must be a valid non-negative dollar amount.");
      setNoticeMessage(null);
      return;
    }

    if (!parsedTicketPrice.ok) {
      setErrorMessage("Ticket price must be a valid non-negative dollar amount.");
      setNoticeMessage(null);
      return;
    }

    if (!parsedCapacity.ok) {
      setErrorMessage("Capacity must be a valid non-negative whole number.");
      setNoticeMessage(null);
      return;
    }

    const payload: PatchPayload = {};

    if (formState.adminNote !== initialFormState.adminNote) {
      payload.adminNote = formState.adminNote;
    }

    if (formState.dealType !== initialFormState.dealType) {
      payload.dealType = formState.dealType;
    }

    if (formState.dealNote !== initialFormState.dealNote) {
      payload.dealNote = formState.dealNote;
    }

    if (parsedQuoteAmount.value !== parsedInitialQuoteAmount.value) {
      payload.quoteAmountCents = parsedQuoteAmount.value;
    }

    if (formState.quoteNote !== initialFormState.quoteNote) {
      payload.quoteNote = formState.quoteNote;
    }

    if (parsedTicketPrice.value !== parsedInitialTicketPrice.value) {
      payload.ticketPriceCents = parsedTicketPrice.value;
    }

    if (formState.ticketPaymentLink !== initialFormState.ticketPaymentLink) {
      payload.ticketPaymentLink = formState.ticketPaymentLink;
    }

    if (parsedCapacity.value !== parsedInitialCapacity.value) {
      payload.capacity = parsedCapacity.value;
    }

    if (formState.publicPage.subtitle !== initialFormState.publicPage.subtitle) {
      payload.subtitle = formState.publicPage.subtitle || null;
    }

    if (formState.publicPage.description !== initialFormState.publicPage.description) {
      payload.description = formState.publicPage.description || null;
    }

    if (formState.publicPage.cover !== initialFormState.publicPage.cover) {
      payload.cover = formState.publicPage.cover || null;
    }

    if (formState.publicPage.videoUrl !== initialFormState.publicPage.videoUrl) {
      payload.videoUrl = formState.publicPage.videoUrl || null;
    }

    if (formState.publicPage.priceNote !== initialFormState.publicPage.priceNote) {
      payload.priceNote = formState.publicPage.priceNote || null;
    }

    if (formState.publicPage.endDate !== initialFormState.publicPage.endDate) {
      payload.endDate = formState.publicPage.endDate || null;
    }

    if (
      arraysDiffer(
        formState.publicPage.gallery,
        initialFormState.publicPage.gallery,
      )
    ) {
      payload.gallery = formState.publicPage.gallery;
    }

    if (
      arraysDiffer(
        formState.publicPage.agenda,
        initialFormState.publicPage.agenda,
      )
    ) {
      payload.agenda = formState.publicPage.agenda;
    }

    if (
      arraysDiffer(formState.publicPage.hosts, initialFormState.publicPage.hosts)
    ) {
      payload.hosts = formState.publicPage.hosts;
    }

    if (
      arraysDiffer(
        formState.publicPage.pricingTiers,
        initialFormState.publicPage.pricingTiers,
      )
    ) {
      payload.pricingTiers = formState.publicPage.pricingTiers;
    }

    if (arraysDiffer(formState.publicPage.faq, initialFormState.publicPage.faq)) {
      payload.faq = formState.publicPage.faq;
    }

    if (Object.keys(payload).length === 0) {
      setErrorMessage(null);
      setNoticeMessage("No changes to save.");
      return;
    }

    const nextBaseline: FormState = { ...formState };

    await runPatchRequest(payload, "save", "Changes saved.", () => {
      setInitialFormState(nextBaseline);
      setFormState(nextBaseline);
    });
  };

  const timeRange =
    event.startTime && event.endTime
      ? `${event.startTime} to ${event.endTime} (${event.timezone})`
      : formatText(event.timezone);

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-slate-950/35"
        onClick={onClose}
      />
      <aside
        aria-labelledby="venue-event-drawer-title"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex w-full justify-end"
        role="dialog"
      >
        <div className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
          <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Venue event
              </p>
              <h2
                className="mt-1 text-xl font-semibold text-slate-950"
                id="venue-event-drawer-title"
              >
                {event.title}
              </h2>
            </div>
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-6 px-6 py-6">
            {errorMessage ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                role="alert"
              >
                {errorMessage}
              </div>
            ) : null}

            {noticeMessage ? (
              <div
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                role="status"
              >
                {noticeMessage}
              </div>
            ) : null}

            {event.type === "KIDS_PROGRAM" ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950">
                Kids programs require the organizer&apos;s certificate of insurance
                and documented supervision ratios before approval.
              </div>
            ) : null}

            <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-base font-semibold text-slate-950">Event details</h3>
              <dl className="mt-4 space-y-4">
                <ReadOnlyRow label="Title" value={event.title} />
                <ReadOnlyRow
                  label="Slug"
                  value={
                    <Link
                      className="text-sky-700 underline underline-offset-2"
                      href={`/events/${event.slug}`}
                      target="_blank"
                    >
                      {event.slug}
                    </Link>
                  }
                />
                <ReadOnlyRow
                  label="Type"
                  value={formatVenueEventTypeLabel(event.type)}
                />
                <ReadOnlyRow label="Date" value={formatDateUtc(event.date)} />
                <ReadOnlyRow label="Time" value={timeRange} />
                <ReadOnlyRow
                  label="Organizer"
                  value={formatText(event.organizerName)}
                />
                <ReadOnlyRow label="Organization" value={formatText(event.orgName)} />
                <ReadOnlyRow
                  label="Contact email"
                  value={formatText(event.contactEmail)}
                />
                <ReadOnlyRow
                  label="Contact phone"
                  value={formatText(event.contactPhone)}
                />
                <ReadOnlyRow
                  label="Expected attendees"
                  value={formatText(event.expectedAttendees)}
                />
                <ReadOnlyRow label="Source" value={formatText(event.source)} />
                <ReadOnlyRow
                  label="Registrations"
                  value={formatText(event.registrationCount)}
                />
                <ReadOnlyRow
                  label="Created"
                  value={formatDateTime(event.createdAt)}
                />
                <ReadOnlyRow
                  label="Description"
                  value={
                    <div className="whitespace-pre-wrap text-sm text-slate-900">
                      {formatText(event.description)}
                    </div>
                  }
                />
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">
                    Admin controls
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Update internal notes, pricing, deal terms, capacity, and
                    public-page content from the same save button.
                  </p>
                </div>
                <button
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => {
                    void handleSave();
                  }}
                  type="button"
                >
                  {requestKey === "save" ? "Saving..." : "Save changes"}
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    Deal type
                  </span>
                  <select
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    onChange={(input) => {
                      const nextValue = input.target.value;

                      if (isDealType(nextValue)) {
                        setFormState((current) => ({
                          ...current,
                          dealType: nextValue,
                        }));
                      }
                    }}
                    value={formState.dealType}
                  >
                    {DEAL_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Capacity</span>
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    inputMode="numeric"
                    onChange={(input) => {
                      setFormState((current) => ({
                        ...current,
                        capacity: input.target.value,
                      }));
                    }}
                    type="number"
                    value={formState.capacity}
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    Quote amount (USD)
                  </span>
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    inputMode="decimal"
                    onChange={(input) => {
                      setFormState((current) => ({
                        ...current,
                        quoteAmount: input.target.value,
                      }));
                    }}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={formState.quoteAmount}
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">
                    Ticket price (USD)
                  </span>
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    inputMode="decimal"
                    onChange={(input) => {
                      setFormState((current) => ({
                        ...current,
                        ticketPrice: input.target.value,
                      }));
                    }}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={formState.ticketPrice}
                  />
                </label>

                <label className="grid gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">
                    Ticket payment link
                  </span>
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    onChange={(input) => {
                      setFormState((current) => ({
                        ...current,
                        ticketPaymentLink: input.target.value,
                      }));
                    }}
                    type="url"
                    value={formState.ticketPaymentLink}
                  />
                </label>

                <label className="grid gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">
                    Quote note
                  </span>
                  <textarea
                    className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    onChange={(input) => {
                      setFormState((current) => ({
                        ...current,
                        quoteNote: input.target.value,
                      }));
                    }}
                    value={formState.quoteNote}
                  />
                </label>

                <label className="grid gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">
                    Deal note
                  </span>
                  <textarea
                    className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    onChange={(input) => {
                      setFormState((current) => ({
                        ...current,
                        dealNote: input.target.value,
                      }));
                    }}
                    value={formState.dealNote}
                  />
                </label>

                <label className="grid gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">
                    Admin note
                  </span>
                  <textarea
                    className="min-h-32 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={isBusy}
                    onChange={(input) => {
                      setFormState((current) => ({
                        ...current,
                        adminNote: input.target.value,
                      }));
                    }}
                    value={formState.adminNote}
                  />
                </label>
              </div>
            </section>

            <VenueEventPublicPageSection
              disabled={isBusy}
              onChange={(next) => {
                setFormState((current) => ({
                  ...current,
                  publicPage: next,
                }));
              }}
              value={formState.publicPage}
            />

            <section className="rounded-xl border border-slate-200 p-5">
              <h3 className="text-base font-semibold text-slate-950">Actions</h3>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => {
                    void runPatchRequest(
                      { status: "APPROVED" },
                      "approve",
                      "Event approved.",
                    );
                  }}
                  type="button"
                >
                  {requestKey === "approve" ? "Approving..." : "Approve"}
                </button>

                <div className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                  <button
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isBusy}
                    onClick={() => {
                      void runPatchRequest(
                        {
                          status: "DECLINED",
                          sendDeclineEmail: declineEmail,
                        },
                        "decline",
                        "Event declined.",
                      );
                    }}
                    type="button"
                  >
                    {requestKey === "decline" ? "Declining..." : "Decline"}
                  </button>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      checked={declineEmail}
                      className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                      disabled={isBusy}
                      onChange={(input) => {
                        setDeclineEmail(input.target.checked);
                      }}
                      type="checkbox"
                    />
                    Send decline email
                  </label>
                </div>

                <button
                  className="rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => {
                    void runPatchRequest(
                      { status: "CANCELLED" },
                      "cancel",
                      "Event cancelled.",
                    );
                  }}
                  type="button"
                >
                  {requestKey === "cancel" ? "Cancelling..." : "Cancel"}
                </button>

                <button
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  onClick={() => {
                    void runPatchRequest(
                      { resyncGcal: true },
                      "resync",
                      "Google Calendar re-sync requested.",
                    );
                  }}
                  type="button"
                >
                  {requestKey === "resync"
                    ? "Requesting sync..."
                    : "Re-sync Google Calendar"}
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-base font-semibold text-slate-950">
                Google Calendar
              </h3>
              <dl className="mt-4 space-y-4">
                <ReadOnlyRow
                  label="Last synced"
                  value={formatDateTime(event.gcalSyncedAt)}
                />
                <ReadOnlyRow
                  label="Event ID"
                  value={formatText(event.gcalEventId)}
                />
                <ReadOnlyRow
                  label="Sync error"
                  value={
                    <span className={event.gcalSyncError ? "text-red-700" : ""}>
                      {formatText(event.gcalSyncError)}
                    </span>
                  }
                />
              </dl>
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <VenueAgreementPanel
                contactEmail={event.contactEmail}
                dealType={event.dealType}
                eventId={event.id}
                latestAgreement={event.latestAgreement}
                onChanged={onChanged}
                variableSpecs={variableSpecs}
              />
              <RentalPaymentPanel
                dealType={event.dealType}
                eventId={event.id}
                onChanged={onChanged}
                quoteAmountCents={event.quoteAmountCents}
                rentalDepositCents={event.rentalDepositCents}
                rentalFeeCents={event.rentalFeeCents}
                rentalPaymentStatus={event.rentalPaymentStatus}
                rentalPaymentUrl={event.rentalPaymentUrl}
              />
            </div>

            <OrganizerEmailPanel event={event} />
          </div>
        </div>
      </aside>
    </div>
  );
}
