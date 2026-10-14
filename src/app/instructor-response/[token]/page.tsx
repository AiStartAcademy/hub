// src/app/instructor-response/[token]/page.tsx
// Public tokenized page where an assigned instructor confirms/declines a cohort
// and marks per-session availability. No login: the token (CohortInstructor.
// responseToken) is the auth, same pattern as /unsubscribe. Editable until the
// cohort ends — instructors can come back and update their answers.

import { brand } from "@/config/brand";
import prisma from "@/lib/prisma";
import ResponseForm from "./ResponseForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `Confirm your participation | ${brand.name}`,
  robots: { index: false, follow: false },
};

export default async function InstructorResponsePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const record = await prisma.cohortInstructor.findUnique({
    where: { responseToken: token },
    select: {
      status: true,
      notes: true,
      respondedAt: true,
      instructor: { select: { name: true } },
      cohort: {
        select: {
          title: true,
          startDate: true,
          endDate: true,
          location: true,
          deliveryMode: true,
          sessions: {
            orderBy: [{ date: "asc" }, { order: "asc" }],
            select: { id: true, title: true, date: true, startTime: true, endTime: true, timezone: true },
          },
        },
      },
      sessionResponses: { select: { sessionId: true, availability: true, note: true } },
    },
  });

  if (!record) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
            {brand.wordmark}
          </p>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">That link didn&apos;t work</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            This response link is invalid or no longer active. Email{" "}
            <a href={`mailto:${brand.email.contact}`} className="underline">{brand.email.contact}</a>{" "}
            and we&apos;ll sort it out.
          </p>
        </div>
      </main>
    );
  }

  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "TBD";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
          {brand.wordmark}
        </p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          {record.cohort.title}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {fmt(record.cohort.startDate)} – {fmt(record.cohort.endDate)}
          {record.cohort.location ? ` · ${record.cohort.location}` : ""} · {record.cohort.deliveryMode}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          Hi {record.instructor.name?.split(" ")[0] ?? "there"} — you&apos;re assigned to teach in this
          cohort. Please confirm your participation and mark your availability for the sessions below.
          You can come back to this link and update your answers any time.
        </p>

        <ResponseForm
          token={token}
          initialStatus={record.status}
          initialNotes={record.notes ?? ""}
          respondedAt={record.respondedAt?.toISOString() ?? null}
          sessions={record.cohort.sessions.map((s) => ({
            id: s.id,
            title: s.title,
            date: fmt(s.date),
            time: `${s.startTime}–${s.endTime} ${s.timezone}`,
            availability:
              record.sessionResponses.find((r) => r.sessionId === s.id)?.availability ?? "UNKNOWN",
            note: record.sessionResponses.find((r) => r.sessionId === s.id)?.note ?? "",
          }))}
        />
      </div>
    </main>
  );
}
