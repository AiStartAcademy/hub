"use client";

// src/components/NewsletterSignup.tsx
//
// The newsletter capture block. Lives on /newsletter and in the marketing
// footer, so it takes a `variant` rather than being forked into two components.
//
// The consent checkbox starts unchecked, always. A pre-checked box is not
// consent, and the API rejects the submission anyway.
import type { JSX } from "react";
import { FormEvent, useId, useState } from "react";
import { brand } from "@/config/brand";

export interface NewsletterSignupProps {
  variant?: "page" | "inline";
  heading?: string;
  blurb?: string;
}

const CONSENT_LABEL =
  `Yes, email me updates from ${brand.name}. I can unsubscribe any time.`;

export function NewsletterSignup({
  variant = "page",
  heading,
  blurb,
}: NewsletterSignupProps): JSX.Element {
  const fieldId = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const isInline = variant === "inline";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!consent) {
      setError("Please confirm you'd like to receive our emails.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/public/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || undefined, consent }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSubscribed(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (subscribed) {
    return (
      <div
        className={
          isInline
            ? "rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-slate-700 dark:text-slate-200"
            : "rounded-2xl border border-primary/30 bg-primary/5 p-8 text-slate-700 dark:text-slate-200"
        }
      >
        <p className={isInline ? "font-semibold" : "text-lg font-semibold"}>You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Check your inbox — a welcome note is on its way.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        isInline
          ? ""
          : "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8 dark:border-slate-800 dark:bg-slate-900"
      }
    >
      {heading ? (
        <h2
          className={
            isInline
              ? "text-base font-semibold text-slate-900 dark:text-white"
              : "text-xl font-bold text-slate-900 dark:text-white"
          }
        >
          {heading}
        </h2>
      ) : null}
      {blurb ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{blurb}</p>
      ) : null}

      <form onSubmit={handleSubmit} className={heading || blurb ? "mt-4 space-y-3" : "space-y-3"}>
        <div className={isInline ? "flex flex-col gap-3 sm:flex-row" : "space-y-3"}>
          <div className={isInline ? "sm:w-40" : ""}>
            <label htmlFor={`${fieldId}-name`} className="sr-only">
              First name (optional)
            </label>
            <input
              id={`${fieldId}-name`}
              type="text"
              autoComplete="given-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="First name (optional)"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <div className="flex-1">
            <label htmlFor={`${fieldId}-email`} className="sr-only">
              Email address
            </label>
            <input
              id={`${fieldId}-email`}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
        </div>

        <label
          htmlFor={`${fieldId}-consent`}
          className="flex cursor-pointer items-start gap-3 text-sm text-slate-600 dark:text-slate-300"
        >
          <input
            id={`${fieldId}-consent`}
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (event.target.checked) setError(null);
            }}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30 dark:border-slate-600"
          />
          <span>{CONSENT_LABEL}</span>
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting ? "Subscribing…" : "Subscribe"}
        </button>
      </form>
    </div>
  );
}

export default NewsletterSignup;
