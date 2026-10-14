"use client";

import { useMemo, useState } from "react";
import { brand } from "@/config/brand";
import { useRouter } from "next/navigation";

export interface ConsentDocument {
  key: string;
  title: string;
  summary: string;
  version: string;
  html: string;
}

interface ConsentFormProps {
  documents: ConsentDocument[];
  marketingReleaseGranted: boolean;
  next: string;
}

export default function ConsentForm({
  documents,
  marketingReleaseGranted,
  next,
}: ConsentFormProps) {
  const router = useRouter();
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [marketingRelease, setMarketingRelease] = useState(marketingReleaseGranted);
  const [expanded, setExpanded] = useState<string | null>(documents[0]?.key ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allAccepted = useMemo(
    () => documents.every((doc) => accepted[doc.key]),
    [documents, accepted]
  );

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptedDocKeys: documents.filter((d) => accepted[d.key]).map((d) => d.key),
          marketingRelease,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      // Full navigation, not router.push: the gate lives in a server-side access check,
      // and a cached RSC payload for the destination would still be the blocked version.
      window.location.href = next;
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {documents.map((doc) => {
        const isOpen = expanded === doc.key;
        const isRecording = doc.key === "recording";
        return (
          <section
            key={doc.key}
            className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-900"
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : doc.key)}
              aria-expanded={isOpen}
              className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="flex flex-col gap-1">
                <span className="text-lg font-semibold text-slate-900 dark:text-white">
                  {doc.title}
                </span>
                <span className="text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {doc.summary}
                </span>
              </span>
              <span className="mt-1 shrink-0 text-sm text-slate-400">
                {isOpen ? "Hide" : "Read"}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-700/60">
                <div className="mb-3 text-xs text-slate-500">
                  Version {doc.version} ·{" "}
                  <a
                    href={`/legal/${doc.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    open in a new tab
                  </a>
                </div>
                <article
                  className="prose prose-slate dark:prose-invert max-h-96 max-w-none overflow-y-auto rounded-xl bg-slate-50 p-4 text-sm prose-p:leading-7 prose-li:leading-7 dark:bg-slate-950"
                  dangerouslySetInnerHTML={{ __html: doc.html }}
                />
              </div>
            )}

            <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-700/60">
              <label className="flex items-start gap-3 text-sm text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={Boolean(accepted[doc.key])}
                  onChange={(e) =>
                    setAccepted((prev) => ({ ...prev, [doc.key]: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  I have read and agree to the <strong>{doc.title}</strong>
                  {isRecording ? ", including that sessions are recorded" : ""}.
                </span>
              </label>

              {isRecording && (
                <label className="mt-3 flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={marketingRelease}
                    onChange={(e) => setMarketingRelease(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span>
                    <strong>Optional.</strong> {brand.name} may use my image, voice,
                    and name in public marketing (social, YouTube, ads, our site).
                    Declining changes nothing about your enrollment, and you can change
                    your mind any time.
                  </span>
                </label>
              )}
            </div>
          </section>
        );
      })}

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white/90 py-4 backdrop-blur dark:border-slate-700/60 dark:bg-slate-950/90">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAccepted || submitting}
          className="w-full rounded-xl bg-primary px-6 py-3 font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Saving…" : "I agree — take me to the course"}
        </button>
        {!allAccepted && (
          <p className="text-center text-sm text-slate-500">
            Check every box above to continue. Questions? {brand.email.contact}
          </p>
        )}
      </div>
    </div>
  );
}
