// src/app/(dashboard)/track-record/page.tsx
//
// "My track record" — the learner's own view. Always their own id, taken from
// the session and never from a route param, so there is nothing to tamper with.

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { getTrackRecord } from "@/lib/trackRecord";
import TrackRecordPanel from "@/components/track-record/TrackRecordPanel";

export const metadata = { title: "My track record" };

export default async function MyTrackRecordPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!session || !userId) redirect("/login");

  const record = await getTrackRecord(userId);
  if (!record) redirect("/dashboard");

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 gap-3 shadow-sm">
        <MobileMenuButton />
        <GraduationCap className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white">My track record</h1>
      </header>
      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          <TrackRecordPanel record={record} />
        </div>
      </main>
    </div>
  );
}
