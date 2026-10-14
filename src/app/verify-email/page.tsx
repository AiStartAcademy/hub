"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { verifyEmail } from "../actions/auth";

function VerifyEmailPageContent() {
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const searchParams = useSearchParams();

  const token = searchParams.get("token");
  const callbackUrl = searchParams.get("callbackUrl");
  const groupId = searchParams.get("groupId");
  const loginUrl = callbackUrl
    ? `/login?callbackUrl=${callbackUrl}${groupId ? `&groupId=${groupId}` : ""}`
    : "/login";

  const onSubmit = useCallback(() => {
    if (success || error) return;

    if (!token) {
      setError("Missing token!");
      return;
    }

    verifyEmail(token)
      .then((data) => {
        setSuccess(data.success);
        setError(data.error);
      })
      .catch(() => {
        setError("Something went wrong!");
      });
  }, [token, success, error]);

  useEffect(() => {
    onSubmit();
  }, [onSubmit]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl p-8 border border-slate-200 dark:border-slate-800 text-center space-y-8 animate-fade-in">
        {!success && !error && (
          <div className="space-y-4">
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto" />
            <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Verifying your email</h1>
            <p className="text-slate-500">Please wait while we confirm your email address...</p>
          </div>
        )}

        {success && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Email Verified!</h1>
              <p className="text-slate-500">{success}</p>
            </div>
            <Link
              href={loginUrl}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-all shadow-lg shadow-primary/25"
            >
              Go to Login <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {error && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <XCircle className="h-10 w-10" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Verification Failed</h1>
              <p className="text-slate-500">{error}</p>
            </div>
            <Link 
              href="/register"
              className="w-full inline-block px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold transition-all"
            >
              Back to Sign Up
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
      <VerifyEmailPageContent />
    </Suspense>
  );
}