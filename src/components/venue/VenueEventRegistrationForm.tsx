"use client";

import type { JSX } from "react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { brand } from "@/config/brand";

export interface VenueEventRegistrationFormProps {
  slug: string;
  isOnline: boolean;
  ticketPriceCents: number | null;
  seatsLeft: number | null;
  waiverVersion: string;
}

type RegistrationSuccess =
  | {
      ok: true;
      status: "CONFIRMED";
      paymentLink: null;
    }
  | {
      ok: true;
      status: "PENDING_PAYMENT";
      paymentLink: string | null;
    };

type RegistrationError = {
  error: string;
};

function formatPrice(ticketPriceCents: number | null): string {
  if (!ticketPriceCents || ticketPriceCents <= 0) {
    return "Free";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(ticketPriceCents / 100);
}

export function VenueEventRegistrationForm({
  slug,
  isOnline,
  ticketPriceCents,
  seatsLeft,
  waiverVersion,
}: VenueEventRegistrationFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [waiverError, setWaiverError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<RegistrationSuccess | null>(null);
  const priceLabel = formatPrice(ticketPriceCents);

  if (seatsLeft === 0) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-semibold text-rose-900">Sold out</p>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          This event has reached capacity. Check back on the events page for future sessions.
        </p>
      </div>
    );
  }

  if (success?.status === "PENDING_PAYMENT") {
    return (
      <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-950">Seat held pending payment</p>
        <p className="text-sm leading-6 text-amber-900">
          Your registration is in progress. Complete payment to finalize your spot.
        </p>
        {success.paymentLink ? (
          <Link
            className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            href={success.paymentLink}
            rel="noopener noreferrer"
            target="_blank"
          >
            Complete payment
          </Link>
        ) : (
          <p className="text-sm leading-6 text-amber-900">
            Payment instructions will be sent separately.
          </p>
        )}
      </div>
    );
  }

  if (success?.status === "CONFIRMED") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-950">Registration confirmed</p>
        <p className="mt-2 text-sm leading-6 text-emerald-900">
          You are on the list. A confirmation email is on the way.
        </p>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitError(null);
    setWaiverError(null);

    if (!isOnline && !waiverAccepted) {
      setWaiverError("You must accept the visitor waiver before registering.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/public/venue-events/${slug}/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          phone: phone.trim() || null,
          waiverAccepted,
        }),
      });

      const payload = (await response.json()) as RegistrationSuccess | RegistrationError;

      if (!response.ok) {
        setSubmitError(
          "error" in payload ? payload.error : "Registration failed. Please try again."
        );
        return;
      }

      setSuccess(payload as RegistrationSuccess);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Network error. Please try again.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-medium text-slate-950">Ticket price: {priceLabel}</p>
        <p className="mt-1">
          {seatsLeft === null
            ? "Capacity is open."
            : `${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} remaining.`}
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-900" htmlFor="event-name">
          Name *
        </label>
        <input
          autoComplete="name"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-950"
          id="event-name"
          name="name"
          onChange={(event) => setName(event.target.value)}
          required
          type="text"
          value={name}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-900" htmlFor="event-email">
          Email *
        </label>
        <input
          autoComplete="email"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-950"
          id="event-email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-900" htmlFor="event-phone">
          Phone
        </label>
        <input
          autoComplete="tel"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-950"
          id="event-phone"
          name="phone"
          onChange={(event) => setPhone(event.target.value)}
          type="tel"
          value={phone}
        />
      </div>

      {!isOnline ? (
        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="flex items-start gap-3">
            <input
              checked={waiverAccepted}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-950"
              id="event-waiver"
              name="event-waiver"
              onChange={(event) => {
                setWaiverAccepted(event.target.checked);
                if (event.target.checked) {
                  setWaiverError(null);
                }
              }}
              type="checkbox"
            />
            <label className="text-sm leading-6 text-slate-700" htmlFor="event-waiver">
              I have read and agree to the {brand.wordmark} visitor waiver{" "}
              <Link
                className="font-medium text-slate-950 underline underline-offset-4"
                href="/waiver"
                rel="noopener noreferrer"
                target="_blank"
              >
                (version {waiverVersion})
              </Link>
              .
            </label>
          </div>
          {waiverError ? (
            <p className="mt-3 text-sm text-rose-700" role="alert">
              {waiverError}
            </p>
          ) : null}
        </div>
      ) : null}

      {submitError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {submitError}
        </div>
      ) : null}

      <button
        className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Submitting..." : "Register now"}
      </button>
    </form>
  );
}
