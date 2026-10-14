// src/app/(dashboard)/admin/consent/page.tsx
//
// Staff view of who has accepted what, and — the part the media team actually needs —
// who has NOT granted promotional use of their likeness. Read-only.
import type { JSX } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasAnyRole } from "@/lib/roles";
import { CRM_STAFF_ROLES } from "@/lib/adminGuard";
import { LEGAL_DOCS, LEGAL_DOC_KEYS, LegalDocKey } from "@/lib/legalDocs";

export const metadata: Metadata = {
  title: "Consent status",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const IN_PERSON_MODES = new Set(["INPERSON", "HYBRID"]);

export default async function AdminConsentPage(): Promise<JSX.Element> {
  const session = await auth();
  // notFound rather than a redirect: a non-staff user shouldn't learn this page exists.
  if (!hasAnyRole(session?.user, [...CRM_STAFF_ROLES])) notFound();

  const students = await prisma.user.findMany({
    where: { enrollments: { some: { status: { not: "dropped" } } } },
    select: {
      id: true,
      name: true,
      email: true,
      marketingReleaseAt: true,
      consents: { select: { docKey: true, version: true } },
      enrollments: {
        where: { status: { not: "dropped" } },
        select: { cohort: { select: { title: true, deliveryMode: true } } },
      },
    },
    orderBy: { email: "asc" },
  });

  const rows = students.map((student) => {
    const inPerson = student.enrollments.some((e) =>
      IN_PERSON_MODES.has(e.cohort.deliveryMode)
    );
    const current = new Set(
      student.consents
        .filter((c) => LEGAL_DOCS[c.docKey as LegalDocKey]?.version === c.version)
        .map((c) => c.docKey)
    );
    const required = LEGAL_DOC_KEYS.filter(
      (key) => LEGAL_DOCS[key].applies === "always" || inPerson
    );
    return {
      ...student,
      required,
      outstanding: required.filter((key) => !current.has(key)),
      cohorts: student.enrollments.map((e) => e.cohort.title).join(", "),
    };
  });

  const doNotPublish = rows.filter((r) => !r.marketingReleaseAt);
  const fullyConsented = rows.filter((r) => r.outstanding.length === 0).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
          Consent status
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {fullyConsented} of {rows.length} enrolled students have accepted everything at
          the current version. {doNotPublish.length} have not granted promotional use of
          their likeness.
        </p>
        <p className="text-sm text-slate-500">
          Document text and versions:{" "}
          {LEGAL_DOC_KEYS.map((key, i) => (
            <span key={key}>
              {i > 0 && " · "}
              <Link href={`/legal/${key}`} className="text-primary hover:underline">
                {LEGAL_DOCS[key].title}
              </Link>{" "}
              <span className="text-slate-400">{LEGAL_DOCS[key].version}</span>
            </span>
          ))}
        </p>
      </header>

      <section className="mb-10 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-700/50 dark:bg-amber-950/30">
        <h2 className="text-lg font-semibold text-amber-950 dark:text-amber-200">
          Do not publish ({doNotPublish.length})
        </h2>
        <p className="mt-1 text-sm text-amber-900 dark:text-amber-300/80">
          These students have not opted in to promotional use of their likeness. Check this
          before cutting a clip or shipping an ad. Note this includes students who have not
          reached the consent page yet, not only those who declined.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-amber-950 dark:text-amber-200">
          {doNotPublish.length === 0 && <li className="text-amber-800">Nobody — everyone opted in.</li>}
          {doNotPublish.map((r) => (
            <li key={r.id}>{r.name?.trim() || r.email}</li>
          ))}
        </ul>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700/60">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Cohorts</th>
              <th className="px-4 py-3 font-medium">Policies</th>
              <th className="px-4 py-3 font-medium">Marketing release</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-200 dark:border-slate-700/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 dark:text-white">
                    {r.name?.trim() || "—"}
                  </div>
                  <div className="text-slate-500">{r.email}</div>
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.cohorts}</td>
                <td className="px-4 py-3">
                  {r.outstanding.length === 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      All {r.required.length} accepted
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      Missing: {r.outstanding.map((k) => LEGAL_DOCS[k].title).join(", ")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.marketingReleaseAt ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Granted {r.marketingReleaseAt.toISOString().slice(0, 10)}
                    </span>
                  ) : (
                    <span className="text-slate-500">Not granted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
