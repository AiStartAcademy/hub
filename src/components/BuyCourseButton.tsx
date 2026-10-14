"use client";
// src/components/BuyCourseButton.tsx
// Self-paced course checkout CTA. Authenticated buyers continue immediately;
// guests provide the account name and email that the verified Stripe webhook
// uses to reconcile access after payment.
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useSession } from "next-auth/react";
import { brand } from "@/config/brand";
import { trackEvent } from "@/lib/analytics";

type GuestDetails = {
  name: string;
  email: string;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
};

function readCheckoutResponse(data: unknown): CheckoutResponse {
  if (typeof data !== "object" || data === null) return {};
  const record = data as Record<string, unknown>;
  return {
    url: typeof record.url === "string" ? record.url : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

export function BuyCourseButton({
  programId,
  programName,
  priceCents,
  label,
  variant = "primary",
}: {
  programId: string;
  programName: string;
  /** null when the program is not yet priced — renders a disabled pre-launch CTA. */
  priceCents: number | null;
  label: string;
  variant?: "primary" | "onDark";
}) {
  const { status } = useSession();
  const [showGuestForm, setShowGuestForm] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyHasAccess, setAlreadyHasAccess] = useState<boolean>(false);

  const buttonClassName = [
    "min-h-[48px] w-full rounded-full px-6 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    variant === "onDark"
      ? "bg-gradient-to-r from-primary-light to-primary text-background-dark hover:brightness-110"
      : "bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200",
  ].join(" ");

  if (priceCents === null) {
    return (
      <div>
        <button
          type="button"
          disabled
          data-track="buy_self_paced_course"
          className={buttonClassName}
        >
          Enrollment opens shortly
        </button>
        <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
          We&rsquo;re finalizing enrollment. Email {brand.email.contact} and
          we&rsquo;ll tell you the moment it opens.
        </p>
      </div>
    );
  }

  const checkoutPriceCents = priceCents;

  async function startCheckout(guest?: GuestDetails): Promise<void> {
    setLoading(true);
    setError(null);
    setAlreadyHasAccess(false);

    try {
      // Forward a ?code= coupon from the landing URL (drip/join links) so the
      // route can pre-apply it, mirroring the cohort pay page.
      const code = new URLSearchParams(window.location.search).get("code");
      const response = await fetch(`/api/programs/${programId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(guest ?? {}), ...(code ? { code } : {}) }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      const { url, error: responseError } = readCheckoutResponse(data);

      if (response.ok && url) {
        trackEvent("begin_checkout", {
          conversion_kind: "course",
          value: checkoutPriceCents / 100,
          currency: "USD",
          item_name: programName,
        });
        window.location.href = url;
        return;
      }

      if (response.status === 409) {
        setAlreadyHasAccess(true);
        setLoading(false);
        return;
      }

      setError(responseError ?? "Could not start checkout. Please try again.");
      setLoading(false);
    } catch {
      setError("Could not start checkout. Please try again.");
      setLoading(false);
    }
  }

  function handleButtonClick(): void {
    if (status === "unauthenticated") {
      setError(null);
      setAlreadyHasAccess(false);
      setShowGuestForm(true);
      return;
    }

    if (status === "authenticated") {
      void startCheckout();
    }
  }

  function handleGuestSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void startCheckout({ name, email });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={loading || status === "loading"}
        data-track="buy_self_paced_course"
        className={buttonClassName}
      >
        {loading ? "Starting…" : label}
      </button>

      {showGuestForm && status === "unauthenticated" && (
        <form onSubmit={handleGuestSubmit} className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
              maxLength={100}
              disabled={loading}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              maxLength={320}
              disabled={loading}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            data-track="buy_self_paced_course"
            className={buttonClassName}
          >
            {loading ? "Starting…" : label}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {alreadyHasAccess && (
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          <p role="alert">You already have access to this course.</p>
          <Link
            href={`/courses/${programId}`}
            className="mt-1 inline-block font-semibold text-accent hover:underline dark:text-primary"
          >
            Go to the course →
          </Link>
        </div>
      )}
    </div>
  );
}
