// src/app/instructor-schedule/[token]/page.tsx
//
// The instructor's own view of everything they've been asked to teach, across every
// upcoming cohort — calendar + agenda, with approve / request-a-different-time /
// decline on each session. Public and tokenized (User.scheduleToken); instructors
// rarely log in, and a login wall is the fastest way to never get an answer.

import { brand } from "@/config/brand";
import { getInstructorSchedule } from "@/lib/instructorSchedule";
import ScheduleClient from "./ScheduleClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `Your teaching schedule | ${brand.name}`,
  robots: { index: false, follow: false },
};

export default async function InstructorSchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await getInstructorSchedule({ token });

  if (!view) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
            {brand.wordmark}
          </p>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">That link didn&apos;t work</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            This schedule link is invalid or no longer active. Email{" "}
            <a href={`mailto:${brand.email.contact}`} className="underline">
              {brand.email.contact}
            </a>{" "}
            and we&apos;ll send you a fresh one.
          </p>
        </div>
      </main>
    );
  }

  return <ScheduleClient token={token} view={view} />;
}
