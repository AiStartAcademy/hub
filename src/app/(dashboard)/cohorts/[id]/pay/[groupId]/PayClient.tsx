"use client";
// Checkout body for a paid Group. The server page (./page.tsx) has already
// verified the group exists and costs more than $0 — free seats never land here.

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { brand } from "@/config/brand";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2, LockKeyhole } from "lucide-react";

export default function PayClient({ cohortId, groupId }: { cohortId: string; groupId: string }) {
  const { status } = useSession();
  const startedForAccount = useRef(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(
    async (guest?: { name: string; email: string }) => {
      setRedirecting(true);
      setError(null);
      try {
        const response = await fetch(`/api/cohorts/${cohortId}/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId, ...guest }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.url) {
          window.location.href = data.url;
          return;
        }
        setError(data.error || "Could not start checkout.");
      } catch {
        setError("Something went wrong starting checkout.");
      } finally {
        setRedirecting(false);
      }
    },
    [cohortId, groupId]
  );

  useEffect(() => {
    if (status !== "authenticated" || startedForAccount.current) return;
    startedForAccount.current = true;
    // Authenticated buyers can continue without re-entering account details.
    void startCheckout();
  }, [startCheckout, status]);

  const handleGuestSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void startCheckout({ name, email });
  };

  if (
    status === "loading" ||
    redirecting ||
    (status === "authenticated" && !error)
  ) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6 text-center">
        <div>
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Redirecting to secure checkout…
          </p>
        </div>
      </div>
    );
  }

  if (status === "authenticated") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-sm">
          <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
            Checkout couldn&apos;t start
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
            {error}
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => void startCheckout()}
              className="rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-dark"
            >
              Try again
            </button>
            <Link
              href={`/cohorts/${cohortId}`}
              className="inline-flex items-center justify-center gap-2 text-sm font-medium text-slate-500 hover:text-primary"
            >
              <ArrowLeft className="h-4 w-4" /> Back to cohort
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <LockKeyhole className="h-10 w-10 text-primary mb-4" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Continue to secure checkout
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
          Enter the details you&apos;ll use for your {brand.name} account. Your seat is created only after Stripe confirms payment.
        </p>

        <form onSubmit={handleGuestSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
              maxLength={100}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              maxLength={320}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-primary dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          {error && (
            <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="w-full rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-dark">
            Continue to Stripe
          </button>
        </form>

        <div className="mt-5 text-center">
          <Link href={`/cohorts/${cohortId}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> Back to cohort
          </Link>
        </div>
      </div>
    </div>
  );
}
