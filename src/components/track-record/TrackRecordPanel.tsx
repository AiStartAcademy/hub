// src/components/track-record/TrackRecordPanel.tsx
//
// Purely presentational, so the learner's own view, the instructor view and the
// staff view on the lead profile all render the same thing. Any permission
// decision happens before this component is reached — see canViewTrackRecord.

import { Award, BookOpen, GraduationCap, ClipboardCheck, Layers } from "lucide-react";
import type { TrackRecord } from "@/lib/trackRecord";

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function score(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}`;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Award;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
      <h2 className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black text-slate-400 mb-3">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h2>
      {children}
    </section>
  );
}

const EMPTY = <p className="text-xs text-slate-400">Nothing here yet.</p>;

export default function TrackRecordPanel({ record }: { record: TrackRecord }) {
  const hasAnything =
    record.enrollments.length > 0 ||
    record.programEnrollments.length > 0 ||
    record.lessons.completed > 0 ||
    record.quizzes.length > 0 ||
    record.assessments.length > 0 ||
    record.certificates.length > 0;

  if (!hasAnything) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center">
        <GraduationCap className="h-8 w-8 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm font-bold text-slate-500">No learning activity yet</p>
        <p className="text-xs text-slate-400 mt-1">
          Cohorts, lessons, tests and certificates will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(
          [
            ["Cohorts", record.enrollments.length],
            ["Lessons done", record.lessons.completed],
            ["Tests taken", record.quizzes.length + record.assessments.length],
            ["Certificates", record.certificates.filter((c) => !c.isRevoked).length],
          ] as const
        ).map(([label, n]) => (
          <div
            key={label}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-center"
          >
            <p className="text-2xl font-black text-slate-900 dark:text-white">{n}</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      <Section title="Cohorts" icon={GraduationCap}>
        {record.enrollments.length === 0 ? EMPTY : (
          <ul className="space-y-1.5 text-sm">
            {record.enrollments.map((e) => (
              <li key={e.cohortId} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{e.cohortTitle}</span>
                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                  {e.status}
                </span>
                <span className="text-xs text-slate-400">joined {fmtDate(e.joinedAt)} · via {e.source}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {record.programEnrollments.length > 0 && (
        <Section title="Programs" icon={Layers}>
          <ul className="space-y-1.5 text-sm">
            {record.programEnrollments.map((p) => (
              <li key={p.programId} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{p.programName}</span>
                <span className="text-xs text-slate-400">joined {fmtDate(p.joinedAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Lessons — ${record.lessons.completed} completed`} icon={BookOpen}>
        {record.lessons.recent.length === 0 ? EMPTY : (
          <ul className="space-y-1.5 text-sm">
            {record.lessons.recent.map((l, i) => (
              <li key={`${l.lessonTitle}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="text-slate-700 dark:text-slate-200">{l.lessonTitle}</span>
                {l.cohortTitle && <span className="text-xs text-slate-400">· {l.cohortTitle}</span>}
                <span className="text-xs text-slate-400 ml-auto">{fmtDate(l.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(record.quizzes.length > 0 || record.assessments.length > 0) && (
        <Section title="Tests" icon={ClipboardCheck}>
          <ul className="space-y-1.5 text-sm">
            {record.quizzes.map((q) => (
              <li key={q.quizTitle} className="flex flex-wrap items-center gap-2">
                <span className="text-slate-700 dark:text-slate-200">{q.quizTitle}</span>
                <span className="text-xs text-slate-400">
                  best {score(q.bestScore)} · {q.attempts} attempt{q.attempts === 1 ? "" : "s"}
                </span>
              </li>
            ))}
            {record.assessments.map((a, i) => (
              <li key={`${a.title}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="text-slate-700 dark:text-slate-200">{a.title}</span>
                <span className="text-xs text-slate-400">
                  score {score(a.totalScore)} · {a.status}
                  {a.cohortTitle ? ` · ${a.cohortTitle}` : ""}
                </span>
                <span className="text-xs text-slate-400 ml-auto">{fmtDate(a.submittedAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Certificates" icon={Award}>
        {record.certificates.length === 0 ? EMPTY : (
          <ul className="space-y-1.5 text-sm">
            {record.certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{c.cohortTitle}</span>
                {c.isRevoked && (
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                    revoked
                  </span>
                )}
                <span className="text-xs text-slate-400">{fmtDate(c.issuedAt)}</span>
                {c.pdfUrl && !c.isRevoked && (
                  <a href={c.pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline ml-auto">
                    PDF
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
