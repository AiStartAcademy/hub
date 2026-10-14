"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, UserPlus, Loader2, LogIn } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { brand } from "@/config/brand";

function isPasswordValid(pwd: string): boolean {
  if (pwd.length < 8) return false;
  if (!/[A-Z]/.test(pwd)) return false;
  if (!/[a-z]/.test(pwd)) return false;
  if (!/[0-9]/.test(pwd)) return false;
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)) return false;
  return true;
}

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");
  const groupId = searchParams.get("groupId");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  const loginUrl = callbackUrl
    ? `/login?callbackUrl=${callbackUrl}${groupId ? `&groupId=${groupId}` : ""}`
    : "/login";

  const googleCallbackUrl = callbackUrl
    ? groupId ? `${callbackUrl}?groupId=${groupId}` : callbackUrl
    : "/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!isPasswordValid(password)) {
      console.warn("[Register] Password does not meet complexity requirements");
      setError("Password does not meet complexity requirements.");
      return;
    }

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, callbackUrl: callbackUrl || undefined, groupId: groupId || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      // Log the user in immediately — email verification is no longer required
      // for access (a verification email was sent; they can verify from Settings).
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInRes?.error) {
        // Account created but auto-login failed — fall back to the confirmation
        // screen so they can sign in manually.
        setSuccess(true);
        return;
      }

      router.push(googleCallbackUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Mobile-only top nav */}
      <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
        <Link
          href="/"
          className="text-sm font-bold text-slate-900 dark:text-white hover:text-primary focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors min-h-[44px] flex items-center"
        >
          ← Home
        </Link>
        <Link
          href="/login"
          className="text-xs font-semibold text-primary hover:text-primary-dark focus-visible:ring-2 focus-visible:ring-primary rounded px-3 min-h-[44px] flex items-center transition-colors"
        >
          Sign In
        </Link>
      </header>

      <div className="flex flex-1">
        {/* Left: Gradient panel */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#0ea5e9] via-primary to-primary-dark relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDE0VjZoLTJWMEgyNHYyaC0yVjBoLTJ2Nmg2djJoMlY2aDR2MmgyVjZoMnYyaDJ2LTJoMlY2aC0yVjBoLTJWMGgtMnYyaC0yVjZoLTJ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
          <div className="relative z-10 flex flex-col justify-center px-16 text-white">
            <div className="mb-8">
              <Image src={brand.assets.logoWide} alt={brand.name} width={240} height={80} className="drop-shadow-2xl h-20 w-auto" />
            </div>
            <p className="text-lg text-white/80 max-w-md leading-relaxed">
              Start your AI learning journey today. Get access to expert-led 
              cohorts and real-world projects.
            </p>
            <div className="mt-12 flex gap-8">
              <div><p className="text-3xl font-bold">100%</p><p className="text-sm text-white/60">Practical Skills</p></div>
              <div><p className="text-3xl font-bold">Free</p><p className="text-sm text-white/60">Community Access</p></div>
              <div><p className="text-3xl font-bold">Live</p><p className="text-sm text-white/60">Sessions</p></div>
            </div>
          </div>
        </div>

        {/* Right: Register form */}
        <div className="flex-1 flex items-center justify-center px-4 sm:px-8 bg-slate-50 dark:bg-slate-950">
          <div className="w-full max-w-md">
            {success ? (
              <div className="text-center space-y-6 animate-fade-in">
                <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-8">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Check your email!</h1>
                <p className="text-slate-500 dark:text-slate-400 text-lg">
                  We've sent a verification link to <span className="font-bold text-slate-900 dark:text-white">{email}</span>. Please click it to activate your account.
                </p>
                <div className="pt-8">
                  <Link
                    href={loginUrl}
                    className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-all shadow-lg shadow-primary/25"
                  >
                    <LogIn className="h-4 w-4" /> Go to Login
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="lg:hidden flex items-center gap-3 mb-8">
                  <Image src={brand.assets.logoWide} alt={brand.name} width={120} height={40} className="rounded-xl h-10 w-auto" />
                  <span className="font-bold text-xl text-slate-900 dark:text-white">{brand.name}</span>
                </div>

                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Create your account</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">Fill in the details below to register as a Student</p>

                {error && (
                  <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">{error}</div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Full Name</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all" placeholder="John Doe" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all" placeholder="you@example.com" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setIsPasswordFocused(true)}
                        onBlur={() => setIsPasswordFocused(false)}
                        className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                        placeholder="••••••••"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Password requirements checklist */}
                    {(isPasswordFocused || password.length > 0) && (
                      <div className="mt-2 space-y-1.5 animate-fade-in">
                        {[
                          { label: "At least 8 characters", valid: password.length >= 8 },
                          { label: "One uppercase letter", valid: /[A-Z]/.test(password) },
                          { label: "One lowercase letter", valid: /[a-z]/.test(password) },
                          { label: "One number", valid: /[0-9]/.test(password) },
                          { label: "One special character (!@#$%^&*)", valid: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) },
                        ].map((req) => (
                          <div key={req.label} className="flex items-center gap-2 text-xs">
                            <div
                              className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-colors ${
                                req.valid ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-400"
                              }`}
                            >
                              {req.valid ? (
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <div className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500" />
                              )}
                            </div>
                            <span className={req.valid ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}>
                              {req.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Terms & Privacy consent */}
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="consent-checkbox"
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary/50 cursor-pointer"
                      required
                    />
                    <label htmlFor="consent-checkbox" className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed cursor-pointer">
                      I agree to the{" "}
                      <Link href="/terms" target="_blank" className="text-primary hover:underline font-medium">
                        Terms of Service
                      </Link>{" "}
                      and{" "}
                      <Link href="/privacy" target="_blank" className="text-primary hover:underline font-medium">
                        Privacy Policy
                      </Link>
                      . I understand how my data will be collected and used.
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !agreedToTerms || !isPasswordValid(password)}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary-dark transition-all shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    {loading ? "Creating account..." : "Sign Up"}
                  </button>
                </form>

                {/* Divider */}
                <div className="mt-6 flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  <span className="text-xs text-slate-400 uppercase font-medium">or</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                </div>

                {/* Google Sign-up */}
                <button
                  type="button"
                  onClick={() => signIn("google", { callbackUrl: googleCallbackUrl })}
                  className="mt-4 w-full py-3 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-sm hover:shadow-md"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>

                <p className="mt-4 text-center text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                  By signing up with Google, you agree to our{" "}
                  <Link href="/terms" target="_blank" className="text-primary hover:underline">Terms of Service</Link>{" "}
                  and{" "}
                  <Link href="/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</Link>.
                </p>

                <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Already have an account?{" "}
                  <Link href={loginUrl} className="font-semibold text-primary hover:text-primary-dark underline underline-offset-4">
                    Sign In
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
      <RegisterPageContent />
    </Suspense>
  );
}
