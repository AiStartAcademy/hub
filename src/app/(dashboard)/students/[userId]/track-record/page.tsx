// src/app/(dashboard)/students/[userId]/track-record/page.tsx
//
// A learner's track record as seen by an instructor or staff member. The id
// comes from the URL here, so the permission check is load-bearing — see
// canViewTrackRecord in src/lib/trackRecord.ts.

import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { getTrackRecord, canViewTrackRecord } from "@/lib/trackRecord";
import TrackRecordPanel from "@/components/track-record/TrackRecordPanel";

export const metadata = { title: "Track record" };

export default async function StudentTrackRecordPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { userId } = await params;
  const viewerId = (session.user as { id?: string } | undefined)?.id ?? null;

  // Checked before the record is loaded — an unauthorized viewer should not be
  // able to infer anything, including whether the account exists.
  if (!canViewTrackRecord(session.user, viewerId, userId)) {
    redirect("/dashboard");
  }

  const record = await getTrackRecord(userId);
  if (!record) notFound();

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950">
      <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 md:px-8 flex-shrink-0 gap-3 shadow-sm">
        <Link href="/instructors" className="text-slate-400 hover:text-primary" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <GraduationCap className="h-5 w-5 text-slate-400 flex-shrink-0" />
        <h1 className="text-base md:text-xl font-bold text-slate-900 dark:text-white truncate">
          {record.user.name || record.user.email}
        </h1>
        <span className="text-xs text-slate-400 hidden sm:inline">track record</span>
      </header>
      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          <TrackRecordPanel record={record} />
        </div>
      </main>
    </div>
  );
}
