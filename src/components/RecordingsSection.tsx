// src/components/RecordingsSection.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlayCircle, Video, X, ArrowUpRight, Lock, Sparkles } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { getProxyUrl } from "@/lib/mediaUtils";

export interface RecordingCard {
  id: string;
  title: string;
  context: string;
  summary: string | null;
  topics: string[];
  duration: number;
  /** Null for non-members — the server never sends them a playable URL. */
  videoUrl: string | null;
  posterUrl: string | null;
  href: string | null;
  /** Pre-formatted on the server so the card doesn't hydrate-mismatch on dates. */
  recordedLabel: string;
}

function formatDuration(seconds: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function TopicChips({ topics }: { topics: string[] }) {
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {topics.map((topic) => (
        <span
          key={topic}
          className="text-[11px] leading-none px-2 py-1 rounded-full bg-primary/10 text-primary dark:bg-primary/20"
        >
          {topic}
        </span>
      ))}
    </div>
  );
}

export default function RecordingsSection({
  recordings,
  isMember,
}: {
  recordings: RecordingCard[];
  isMember: boolean;
}) {
  const [active, setActive] = useState<RecordingCard | null>(null);

  // Escape closes the player, and the body must not scroll behind the overlay.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden animate-fade-in">
      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700/50 flex justify-between items-center gap-3 bg-slate-50/50 dark:bg-slate-800/30">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            Latest Recordings
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Newest sessions from every cohort
            {isMember ? "" : " · members only"}
          </p>
        </div>
        {isMember ? (
          <Link
            href="/courses"
            className="text-sm text-primary hover:text-primary-dark font-medium transition-colors flex-shrink-0"
          >
            View all →
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full flex-shrink-0">
            <Lock className="h-3.5 w-3.5" />
            Members only
          </span>
        )}
      </div>

      {recordings.length === 0 ? (
        <div className="px-6 py-10 text-center text-slate-500 dark:text-slate-400 text-sm">
          No recordings available yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-6">
          {recordings.map((rec) => {
            const duration = formatDuration(rec.duration);
            const posterSrc = rec.posterUrl ? getProxyUrl(rec.posterUrl) : null;
            return (
              <div
                key={rec.id}
                className="group rounded-xl border border-slate-200 dark:border-slate-700/50 overflow-hidden bg-slate-50/50 dark:bg-slate-800/30 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 flex flex-col"
              >
                {isMember && rec.videoUrl ? (
                  <button
                    type="button"
                    onClick={() => setActive(rec)}
                    aria-label={`Play ${rec.title}`}
                    className={`relative aspect-video w-full flex items-center justify-center ${posterSrc ? "" : "bg-gradient-to-br from-slate-800 to-slate-900"}`}
                  >
                    {posterSrc && (
                      <>
                        <img
                          src={posterSrc}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/35" />
                      </>
                    )}
                    <PlayCircle className="relative z-10 h-12 w-12 text-white/70 group-hover:text-white group-hover:scale-110 transition-all" />
                    {duration && (
                      <span className="absolute bottom-2 right-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {duration}
                      </span>
                    )}
                  </button>
                ) : (
                  <div
                    className={`relative aspect-video w-full flex flex-col items-center justify-center gap-1.5 ${posterSrc ? "" : "bg-gradient-to-br from-slate-700 to-slate-900"}`}
                  >
                    {posterSrc && (
                      <>
                        <img
                          src={posterSrc}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/35" />
                      </>
                    )}
                    <Lock className="relative z-10 h-8 w-8 text-white/50" />
                    <span className="relative z-10 text-[11px] font-medium text-white/50">
                      Members only
                    </span>
                    {duration && (
                      <span className="absolute bottom-2 right-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        {duration}
                      </span>
                    )}
                  </div>
                )}

                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">
                    {rec.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                    {rec.context}
                  </p>
                  {rec.summary && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 line-clamp-3 leading-relaxed">
                      {rec.summary}
                    </p>
                  )}
                  <TopicChips topics={rec.topics} />
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-auto pt-3 flex items-center justify-between gap-2">
                    <span>{rec.recordedLabel}</span>
                    {isMember && rec.href && (
                      <Link
                        href={rec.href}
                        className="text-primary hover:text-primary-dark font-medium inline-flex items-center gap-0.5"
                      >
                        Full course <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isMember && recordings.length > 0 && (
        <div className="px-6 pb-6">
          <div className="rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 dark:from-primary/20 dark:to-accent/20 border border-primary/20 p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Unlock every cohort recording
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                Membership gives you unlimited access to the recordings from every
                past cohort, plus weekly Q&amp;A calls and the community.
              </p>
            </div>
            <Link
              href="/cohorts#membership"
              className="flex-shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-semibold shadow-lg shadow-primary/25 transition-all"
            >
              Become a member →
            </Link>
          </div>
        </div>
      )}

      {active?.videoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActive(null)}
          role="dialog"
          aria-modal="true"
          aria-label={active.title}
        >
          <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <h3 className="text-white font-semibold truncate">{active.title}</h3>
                <p className="text-xs text-white/60 truncate">{active.context}</p>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                aria-label="Close player"
                className="text-white/70 hover:text-white transition-colors flex-shrink-0"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <VideoPlayer url={active.videoUrl} poster={active.posterUrl ?? undefined} />
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {active.summary && (
                  <p className="text-sm text-white/70 line-clamp-3">{active.summary}</p>
                )}
                <TopicChips topics={active.topics} />
              </div>
              {active.href && (
                <Link
                  href={active.href}
                  className="flex-shrink-0 text-sm font-medium text-primary hover:text-primary-dark inline-flex items-center gap-1"
                >
                  Open full course <ArrowUpRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
