import type { Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import AccountSetupForm from "./AccountSetupForm";

export const metadata: Metadata = {
  title: "Set up your account",
  robots: { index: false, follow: false },
};

export default function SetPasswordPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <Suspense fallback={<Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />}>
          <AccountSetupForm />
        </Suspense>
      </div>
    </main>
  );
}
