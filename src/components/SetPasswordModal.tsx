"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  X,
} from "lucide-react";
import { isPasswordValid } from "@/lib/password";

interface SetPasswordModalProps {
  isOpen: boolean;
  email: string | null;
  name?: string;
  onDismiss: () => void;
  onSuccess: () => void;
}

type ClaimAccountSuccess = {
  success: true;
  email: string;
};

type ClaimAccountError = {
  error: string;
  loginUrl?: string;
};

type SignInResultShape = {
  error?: string;
};

function isClaimAccountSuccess(value: unknown): value is ClaimAccountSuccess {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.success === true && typeof candidate.email === "string";
}

function isClaimAccountError(value: unknown): value is ClaimAccountError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.error !== "string") return false;
  return candidate.loginUrl === undefined || typeof candidate.loginUrl === "string";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export default function SetPasswordModal({
  isOpen,
  email,
  name,
  onDismiss,
  onSuccess,
}: SetPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [existingAccountMessage, setExistingAccountMessage] = useState("");

  const passwordChecks = useMemo(
    () => [
      { label: "At least 8 characters", valid: password.length >= 8 },
      { label: "One uppercase letter", valid: /[A-Z]/.test(password) },
      { label: "One lowercase letter", valid: /[a-z]/.test(password) },
      { label: "One number", valid: /[0-9]/.test(password) },
      {
        label: "One special character",
        valid: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
      },
    ],
    [password]
  );

  if (!isOpen || !email) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setExistingAccountMessage("");

    if (!isPasswordValid(password)) {
      setError("Password does not meet complexity requirements.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/lead/claim-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(name ? { name } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Unexpected server response.");
      }

      const payload: unknown = await response.json();
      if (response.status === 409) {
        if (!isClaimAccountError(payload)) {
          throw new Error("Unexpected server response.");
        }
        setExistingAccountMessage(payload.error);
        return;
      }

      if (!response.ok) {
        if (isClaimAccountError(payload)) {
          setError(payload.error);
          return;
        }
        throw new Error("Something went wrong. Please try again.");
      }

      if (!isClaimAccountSuccess(payload)) {
        throw new Error("Unexpected server response.");
      }

      const signInResult = await withTimeout(
        signIn("credentials", {
          email: payload.email,
          password,
          redirect: false,
        }),
        10_000,
        "Sign-in timed out. Please try logging in manually."
      );

      if (
        signInResult &&
        typeof signInResult === "object" &&
        "error" in signInResult &&
        typeof (signInResult as SignInResultShape).error === "string"
      ) {
        throw new Error((signInResult as SignInResultShape).error);
      }

      onSuccess();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-[90] px-4 pointer-events-none animate-in fade-in duration-200">
      <div className="mx-auto flex max-w-6xl justify-center sm:justify-end">
        <div className="pointer-events-auto w-full max-w-md rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white">
                Save Your Progress
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {name
                  ? `Set a password so you can come back, ${name}, and pick up this lesson where you left off.`
                  : "Set a password so you can come back to this course and keep your place."}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              disabled={submitting}
              className="rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              aria-label="Close save progress modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={email}
                readOnly
                aria-readonly="true"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                required
                autoFocus
                type={showPassword ? "text" : "password"}
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 py-3 pl-11 pr-12 text-sm focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Password requirements
              </p>
              <div className="space-y-2">
                {passwordChecks.map((check) => (
                  <div
                    key={check.label}
                    className={`flex items-center gap-2 text-xs ${
                      check.valid
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {check.valid ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5" />
                    )}
                    <span>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {existingAccountMessage && (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                <p>{existingAccountMessage}</p>
                <Link href="/login" className="mt-2 inline-block font-bold underline underline-offset-4">
                  Go to login
                </Link>
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 py-2 text-center text-xs font-medium text-red-500 dark:bg-red-900/20">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary-dark disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Password
            </button>

            <button
              type="button"
              onClick={onDismiss}
              disabled={submitting}
              className="w-full rounded-xl bg-slate-100 py-3 text-sm font-bold uppercase tracking-widest text-slate-900 transition-all hover:bg-slate-200 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
            >
              Maybe Later
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
