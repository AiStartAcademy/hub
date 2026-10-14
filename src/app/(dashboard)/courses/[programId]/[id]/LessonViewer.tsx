// src/app/(dashboard)/courses/[programId]/[id]/LessonViewer.tsx
"use client";

import {
  Video,
  FileText,
  CheckCircle,
  ArrowLeft,
  Clock,
  Tag,
  Headphones,
  ScrollText,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  RotateCcw,
  Mail,
  User,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import VideoPlayer, { VideoPlayerHandle } from "@/components/VideoPlayer";
import { getProxyUrl } from "@/lib/mediaUtils";
import {
  resolveDefaultTrack,
  type LessonVideoTrack,
} from "@/lib/lessonVideos";
import LeadCaptureModal from "@/components/LeadCaptureModal";
import SetPasswordModal from "@/components/SetPasswordModal";
import { readLeadEmailCookie, readLeadNameCookie } from "@/lib/lead-cookie";

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuizOption {
  id: string;
  text: string;
  order: number;
}

interface QuizItem {
  id: string;
  questionText: string;
  type: string;
  order: number;
  options: QuizOption[];
}

interface QuizSubmissionAnswer {
  itemId: string;
  selectedOptions: { optionId: string }[];
  textAnswer: string | null;
}

interface QuizSubmission {
  id: string;
  attemptNumber: number;
  totalScore: number | null;
  status: string;
  answers?: QuizSubmissionAnswer[];
}

interface Quiz {
  id: string;
  name: string | null;
  maxAttempts: number | null;
  items: QuizItem[];
  submissions: QuizSubmission[];
}

interface Lesson {
  id: string;
  name: string;
  type: string;
  text: string | null;
  videoUrl: string | null;
  posterUrl: string | null;
  videos?: LessonVideoTrack[];
  intro: string | null;
  timecodes: string | null;
  tags: string | null;
  duration: number;
  audioUrl: string | null;
  captionsUrl: string | null;
  moduleId: string;
  quiz: Quiz | null;
}

interface ModuleLesson {
  id: string;
  name: string;
  type: string;
  duration: number;
  order: number;
}

interface ModuleAssessment {
  id: string;
  name: string;
  order: number;
}

interface ModuleData {
  id: string;
  name: string;
  lessons?: ModuleLesson[];
  assessments?: ModuleAssessment[];
}

interface NavItem {
  id: string;
  name: string;
  type: string;
}

interface SubmitResult {
  itemId: string;
  type: string;
  correct: boolean | null;
  correctOptionIds?: string[];
  selectedOptionIds?: string[];
}

interface SubmitResponse {
  submissionId: string;
  attemptNumber: number;
  totalScore: number | null;
  status: string;
  attemptsLeft: number | null;
  result: SubmitResult[];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTimecodes(
  timecodesStr: string
): { time: string; seconds: number; label: string }[] {
  if (!timecodesStr) return [];
  return timecodesStr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
      if (!match) return null;
      const time = match[1];
      const label = match[2];
      const parts = time.split(":").map(Number);
      let seconds = 0;
      if (parts.length === 3) {
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else {
        seconds = parts[0] * 60 + parts[1];
      }
      return { time, seconds, label };
    })
    .filter(Boolean) as { time: string; seconds: number; label: string }[];
}

// ─── LessonNavigation ─────────────────────────────────────────────────────────

function LessonNavigation({
  prev,
  next,
  programId,
  cohortId,
  loading = false,
}: {
  prev: NavItem | null;
  next: NavItem | null;
  programId: string;
  cohortId: string | null;
  loading?: boolean;
}) {
  const buildHref = (id: string) => {
    const base = `/courses/${programId}/${id}`;
    return cohortId ? `${base}?cohortId=${cohortId}` : base;
  };

  const typeIcon = (type: string) =>
    type === "video" ? "🎬" : type === "assessment" ? "✏️" : "📄";

  // Skeleton while the data loads
  const skeletonContent = (align: "left" | "right") => (
    <div
      className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 min-w-0 ${
        align === "right" ? "justify-end" : ""
      }`}
    >
      {align === "left" && (
        <ChevronLeft className="h-5 w-5 text-slate-200 dark:text-slate-700 shrink-0" />
      )}
      <div className={`min-w-0 space-y-1.5 ${align === "right" ? "text-right" : ""}`}>
        <div className="h-2 w-12 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse" />
        <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse" />
      </div>
      {align === "right" && (
        <ChevronRight className="h-5 w-5 text-slate-200 dark:text-slate-700 shrink-0" />
      )}
    </div>
  );

  // Placeholder when there is no previous/next lesson
  const stubContent = (align: "left" | "right") => (
    <div
      className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 min-w-0 ${
        align === "right" ? "justify-end" : ""
      }`}
    >
      {align === "left" && (
        <ChevronLeft className="h-5 w-5 text-slate-400 dark:text-slate-500 shrink-0" />
      )}
      <div className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-600 mb-0.5">
          {align === "left" ? "Previous" : "Next"}
        </p>
        <p className="text-sm font-semibold text-slate-400 dark:text-slate-500">
          {align === "left" ? "First lesson" : "Last lesson"}
        </p>
      </div>
      {align === "right" && (
        <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500 shrink-0" />
      )}
    </div>
  );

  return (
    <div className="flex items-stretch gap-3 w-full">
      {/* Previous button */}
      {loading ? (
        skeletonContent("left")
      ) : prev ? (
        <Link
          href={buildHref(prev.id)}
          className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary/50 hover:bg-primary/5 dark:hover:bg-primary/10 transition-all group min-w-0"
        >
          <ChevronLeft className="h-5 w-5 text-slate-400 group-hover:text-primary transition-colors shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-primary/70 transition-colors mb-0.5">
              Previous
            </p>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 group-hover:text-primary transition-colors truncate">
              {typeIcon(prev.type)} {prev.name}
            </p>
          </div>
        </Link>
      ) : (
        stubContent("left")
      )}

      {/* Next button */}
      {loading ? (
        skeletonContent("right")
      ) : next ? (
        <Link
          href={buildHref(next.id)}
          className="flex-1 flex items-center justify-end gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary/50 hover:bg-primary/5 dark:hover:bg-primary/10 transition-all group text-right min-w-0"
        >
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-primary/70 transition-colors mb-0.5">
              Next
            </p>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 group-hover:text-primary transition-colors truncate">
              {typeIcon(next.type)} {next.name}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-primary transition-colors shrink-0" />
        </Link>
      ) : (
        stubContent("right")
      )}
    </div>
  );
}

// ─── BottomNavBar ─────────────────────────────────────────────────────────────

function BottomNavBar({
  prev,
  next,
  programId,
  cohortId,
  loading,
  onLecturesClick,
}: {
  prev: NavItem | null;
  next: NavItem | null;
  programId: string;
  cohortId: string | null;
  loading?: boolean;
  onLecturesClick: () => void;
}) {
  const buildHref = (id: string) => {
    const base = `/courses/${programId}/${id}`;
    return cohortId ? `${base}?cohortId=${cohortId}` : base;
  };

  const typeIcon = (type: string) =>
    type === "video" ? "🎬" : type === "assessment" ? "✏️" : "📄";

  const PrevBtn = () => {
    if (loading) {
      return (
        <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 min-w-0">
          <ChevronLeft className="h-5 w-5 text-slate-200 dark:text-slate-700 shrink-0" />
          <div className="space-y-1.5">
            <div className="h-2 w-12 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse" />
            <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse" />
          </div>
        </div>
      );
    }
    if (!prev) {
      return (
        <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 min-w-0">
          <ChevronLeft className="h-5 w-5 text-slate-400 dark:text-slate-500 shrink-0" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-0.5">
              Previous
            </p>
            <p className="text-sm font-semibold text-slate-400 dark:text-slate-500">
              First lesson
            </p>
          </div>
        </div>
      );
    }
    return (
      <Link
        href={buildHref(prev.id)}
        className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary/50 hover:bg-primary/5 dark:hover:bg-primary/10 transition-all group min-w-0"
      >
        <ChevronLeft className="h-5 w-5 text-slate-400 group-hover:text-primary transition-colors shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-primary/70 transition-colors mb-0.5">
            Previous
          </p>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 group-hover:text-primary transition-colors truncate">
            {typeIcon(prev.type)} {prev.name}
          </p>
        </div>
      </Link>
    );
  };

  const NextBtn = () => {
    if (loading) {
      return (
        <div className="flex-1 flex items-center justify-end gap-3 px-4 py-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 min-w-0">
          <div className="space-y-1.5 text-right">
            <div className="h-2 w-12 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse ml-auto" />
            <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse" />
          </div>
          <ChevronRight className="h-5 w-5 text-slate-200 dark:text-slate-700 shrink-0" />
        </div>
      );
    }
    if (!next) {
      return (
        <div className="flex-1 flex items-center justify-end gap-3 px-4 py-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 min-w-0">
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-0.5">
              Next
            </p>
            <p className="text-sm font-semibold text-slate-400 dark:text-slate-500">
              Last lesson
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-400 dark:text-slate-500 shrink-0" />
        </div>
      );
    }
    return (
      <Link
        href={buildHref(next.id)}
        className="flex-1 flex items-center justify-end gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-primary/50 hover:bg-primary/5 dark:hover:bg-primary/10 transition-all group text-right min-w-0"
      >
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-primary/70 transition-colors mb-0.5">
            Next
          </p>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 group-hover:text-primary transition-colors truncate">
            {typeIcon(next.type)} {next.name}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-primary transition-colors shrink-0" />
      </Link>
    );
  };

  const LecturesBtn = () => (
    <button
      onClick={onLecturesClick}
      className="w-full sm:w-36 shrink-0 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm uppercase tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
    >
      📚 Lectures
    </button>
  );

  return (
    <div className="space-y-2 sm:space-y-0">
      {/* Desktop: [Prev] [Lectures] [Next] */}
      <div className="hidden sm:flex items-stretch gap-3 w-full">
        <PrevBtn />
        <LecturesBtn />
        <NextBtn />
      </div>

      {/* Mobile: [Prev] [Next], then [Lectures] */}
      <div className="flex sm:hidden flex-col gap-2 w-full">
        <div className="flex gap-2">
          <PrevBtn />
          <NextBtn />
        </div>
        <LecturesBtn />
      </div>
    </div>
  );
}

// ─── CollapsibleSection ───────────────────────────────────────────────────────

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  icon,
  title,
  badge,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group"
      >
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
          {icon}
        </span>
        <span className="flex-1 text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
          {title}
        </span>
        {badge && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
        <span className="text-slate-400 group-hover:text-primary transition-colors">
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>
      <div className={open ? "px-5 pb-5" : "hidden"}>{children}</div>
    </div>
  );
}

// ─── TimecodesPanel ───────────────────────────────────────────────────────────

interface TimecodeEntry {
  time: string;
  seconds: number;
  label: string;
}

function TimecodesPanel({
  timecodes,
  onTimecodeClick,
}: {
  timecodes: TimecodeEntry[];
  onTimecodeClick: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const list = (
    <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
      {timecodes.map((tc, i) => (
        <button
          key={i}
          onClick={() => onTimecodeClick(tc.seconds)}
          className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors group"
        >
          <span className="shrink-0 font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-lg group-hover:bg-primary group-hover:text-white transition-colors">
            {tc.time}
          </span>
          <span className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-snug pt-0.5">
            {tc.label}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="lg:w-80 lg:shrink-0">
      <div className="bg-white dark:bg-slate-900 sm:rounded-2xl border-y sm:border border-slate-200 dark:border-slate-800 shadow-sm lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2 lg:cursor-default lg:pointer-events-none"
        >
          <Clock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
          <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex-1 text-left">
            Timecodes
          </h3>
          <span className="lg:hidden text-slate-400">
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </button>
        <div className="hidden lg:block">{list}</div>
        <div className={`lg:hidden overflow-y-auto ${open ? "block max-h-72" : "hidden"}`}>{list}</div>
      </div>
    </div>
  );
}

// ─── AudioPlayer ─────────────────────────────────────────────────────────────

function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const isDragging = useRef(false);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    playing ? audio.pause() : audio.play();
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    // Update UI immediately while dragging, without touching audio.currentTime
    setCurrentTime(time);
  };

  const handleSeekCommit = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = Number((e.currentTarget as HTMLInputElement).value);
    audio.currentTime = time;
    isDragging.current = false;
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const skip = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(
      Math.max(audio.currentTime + seconds, 0),
      duration
    );
  };

  const formatTime = (s: number) => {
    if (!isFinite(s) || s === 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5 space-y-4">
      <audio
        ref={audioRef}
        src={getProxyUrl(url)}
        preload="auto"
        onCanPlay={() => setLoading(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => {
          if (!isDragging.current) {
            setCurrentTime(audioRef.current?.currentTime ?? 0);
          }
        }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
      />
      <div className="space-y-1">
        <div className="relative h-2">
          <div className="absolute inset-0 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all pointer-events-none"
            style={{ width: `${progress}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeekChange}
            onMouseDown={() => { isDragging.current = true; }}
            onTouchStart={() => { isDragging.current = true; }}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
        <div className="flex justify-between text-[11px] font-mono text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => skip(-10)}
          className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-primary transition-colors"
        >
          <RotateCcw className="h-5 w-5" />
          <span className="text-[10px] font-bold">10s</span>
        </button>
        <button
          onClick={togglePlay}
          disabled={loading}
          className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5 ml-0.5"
            >
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => skip(10)}
          className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-primary transition-colors"
        >
          <RotateCcw className="h-5 w-5 -scale-x-100" />
          <span className="text-[10px] font-bold">10s</span>
        </button>
        <button
          onClick={cyclePlaybackRate}
          className="text-xs font-black text-slate-400 hover:text-primary transition-colors bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-lg min-w-[3rem] text-center"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}

// ─── TextVersion ─────────────────────────────────────────────────────────────

function TextVersion({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(getProxyUrl(url))
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      })
      .then((t) => setText(t))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading transcript…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-sm py-4">
        <AlertCircle className="h-4 w-4" />
        Failed to load transcript.
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

// ─── QuizBlock ───────────────────────────────────────────────────────────────

function QuizBlock({ quiz, userId }: { quiz: Quiz; userId?: string }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [freeTextAnswers, setFreeTextAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitResponse, setSubmitResponse] = useState<SubmitResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});

  const lastSubmission = quiz.submissions?.[0] ?? null;
  const [showingPrevResult, setShowingPrevResult] = useState(!!lastSubmission);

  const attemptsUsed = lastSubmission?.attemptNumber ?? 0;
  const attemptsLeft =
    quiz.maxAttempts !== null ? quiz.maxAttempts - attemptsUsed : null;

  const canRetry = !submitting && (attemptsLeft === null || attemptsLeft > 0);

  const handleSingleChoice = (itemId: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [itemId]: [optionId] }));
    setValidationErrors((prev) => ({ ...prev, [itemId]: false }));
  };

  const handleMultipleChoice = (itemId: string, optionId: string) => {
    setAnswers((prev) => {
      const current = prev[itemId] ?? [];
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      if (next.length > 0) {
        setValidationErrors((ve) => ({ ...ve, [itemId]: false }));
      }
      return { ...prev, [itemId]: next };
    });
  };

  const validate = (): boolean => {
    const errors: Record<string, boolean> = {};
    let hasError = false;
    for (const item of quiz.items) {
      const isEmpty =
        item.type === "free_text"
          ? !freeTextAnswers[item.id]?.trim()
          : !answers[item.id]?.length;
      if (isEmpty) {
        errors[item.id] = true;
        hasError = true;
      }
    }
    setValidationErrors(errors);
    return !hasError;
  };

  const handleSubmit = async () => {
    if (!userId) {
      setSubmitError("You must be logged in to submit.");
      return;
    }
    if (!validate()) {
      setSubmitError("Please answer all questions before submitting.");
      return;
    }

    const combined: Record<string, string[] | string> = {};
    for (const item of quiz.items) {
      if (item.type === "free_text") {
        combined[item.id] = freeTextAnswers[item.id] ?? "";
      } else {
        combined[item.id] = answers[item.id] ?? [];
      }
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/quiz/${quiz.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: combined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Submission failed");
      }

      const data: SubmitResponse = await res.json();
      setSubmitResponse(data);
      setShowingPrevResult(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setAnswers({});
    setFreeTextAnswers({});
    setSubmitResponse(null);
    setSubmitError(null);
    setValidationErrors({});
    setShowingPrevResult(false);
  };

  const activeResult = submitResponse ?? null;
  const prevResult = showingPrevResult ? lastSubmission : null;

  if (activeResult || prevResult) {
    const score = activeResult?.totalScore ?? prevResult?.totalScore ?? null;
    const attempt =
      activeResult?.attemptNumber ?? prevResult?.attemptNumber ?? 1;
    const attemptsLeftAfter = activeResult?.attemptsLeft ?? attemptsLeft;
    const isPrevious = !activeResult && !!prevResult;

    return (
      <div className="space-y-4">
        <div
          className={`rounded-2xl p-5 border text-center ${
            score === null
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/30"
              : score >= 80
              ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/30"
              : score >= 50
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/30"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/30"
          }`}
        >
          {score !== null ? (
            <>
              <div
                className={`text-4xl font-black mb-1 ${
                  score >= 80
                    ? "text-emerald-500"
                    : score >= 50
                    ? "text-amber-500"
                    : "text-red-500"
                }`}
              >
                {score}%
              </div>
              <div className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                {score >= 80
                  ? "Excellent!"
                  : score >= 50
                  ? "Keep it up"
                  : "Try again"}
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-black mb-1 text-amber-500">
                Submitted
              </div>
              <div className="text-sm text-slate-500">
                Awaiting manual review
              </div>
            </>
          )}
          <div className="mt-2 text-xs text-slate-400">
            Attempt {attempt}
            {quiz.maxAttempts !== null ? ` / ${quiz.maxAttempts}` : ""}
            {isPrevious && " · Previous result"}
          </div>
        </div>

        {activeResult && (
          <div className="space-y-3">
            {quiz.items.map((item, idx) => {
              const itemResult = activeResult.result.find(
                (r) => r.itemId === item.id
              );
              const resultCorrect = itemResult?.correct;

              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 ${
                    resultCorrect === null
                      ? "border-slate-200 dark:border-slate-700"
                      : resultCorrect
                      ? "border-emerald-200 dark:border-emerald-800/30 bg-emerald-50/50 dark:bg-emerald-900/10"
                      : "border-red-200 dark:border-red-800/30 bg-red-50/50 dark:bg-red-900/10"
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-xs font-black text-slate-400 shrink-0 mt-0.5">
                      {idx + 1}.
                    </span>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {item.questionText}
                    </p>
                    {resultCorrect !== null && (
                      <span
                        className={`shrink-0 ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                          resultCorrect
                            ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30"
                            : "bg-red-100 text-red-600 dark:bg-red-900/30"
                        }`}
                      >
                        {resultCorrect ? "✓ Correct" : "✗ Wrong"}
                      </span>
                    )}
                  </div>
                  {item.type !== "free_text" && (
                    <div className="space-y-1 mt-2 ml-5">
                      {item.options.map((opt) => {
                        const wasSelected =
                          itemResult?.selectedOptionIds?.includes(opt.id);
                        const isRight = itemResult?.correctOptionIds?.includes(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                              isRight
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : wasSelected && !isRight
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {isRight ? "✓ " : wasSelected ? "✗ " : "  "}
                            {opt.text}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canRetry && (
          <button
            onClick={handleRetry}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/30 text-primary text-sm font-bold hover:bg-primary/5 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
            {attemptsLeftAfter !== null && (
              <span className="text-xs text-slate-400 font-normal">
                ({attemptsLeftAfter} attempt
                {attemptsLeftAfter !== 1 ? "s" : ""} left)
              </span>
            )}
          </button>
        )}
        {!canRetry && attemptsLeft === 0 && (
          <p className="text-center text-xs text-slate-400 py-2">
            No attempts remaining.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {quiz.items.map((item, idx) => {
        const hasError = validationErrors[item.id];

        return (
          <div
            key={item.id}
            className={`rounded-xl border bg-slate-50/50 dark:bg-slate-800/30 p-4 transition-colors ${
              hasError
                ? "border-red-300 dark:border-red-700/60 bg-red-50/30 dark:bg-red-900/10"
                : "border-slate-200 dark:border-slate-700"
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                <span className="text-slate-400 mr-1.5">{idx + 1}.</span>
                {item.questionText}
              </p>
              {hasError && (
                <span className="shrink-0 text-xs font-bold text-red-500 flex items-center gap-1 mt-0.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Required
                </span>
              )}
            </div>

            {item.type === "single_choice" && (
              <div className="space-y-2">
                {item.options.map((opt) => {
                  const isSelected = (answers[item.id] ?? [])[0] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSingleChoice(item.id, opt.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all duration-150 ${
                        isSelected
                          ? "border-primary bg-primary/5 dark:bg-primary/15 shadow-sm"
                          : "border-slate-200 dark:border-slate-700 hover:border-primary/40 hover:bg-white dark:hover:bg-slate-800"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-slate-300 dark:border-slate-600"
                        }`}
                      >
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-white block" />
                        )}
                      </span>
                      <span
                        className={`text-sm transition-colors ${
                          isSelected
                            ? "text-primary font-semibold"
                            : "text-slate-700 dark:text-slate-300 font-medium"
                        }`}
                      >
                        {opt.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {item.type === "multiple_choice" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                  Select all that apply
                </p>
                {item.options.map((opt) => {
                  const isSelected = (answers[item.id] ?? []).includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleMultipleChoice(item.id, opt.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all duration-150 ${
                        isSelected
                          ? "border-primary bg-primary/5 dark:bg-primary/15 shadow-sm"
                          : "border-slate-200 dark:border-slate-700 hover:border-primary/40 hover:bg-white dark:hover:bg-slate-800"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-slate-300 dark:border-slate-600"
                        }`}
                      >
                        {isSelected && (
                          <svg viewBox="0 0 12 10" fill="none" className="w-3 h-3">
                            <path
                              d="M1 5l3.5 3.5L11 1"
                              stroke="white"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <span
                        className={`text-sm transition-colors ${
                          isSelected
                            ? "text-primary font-semibold"
                            : "text-slate-700 dark:text-slate-300 font-medium"
                        }`}
                      >
                        {opt.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {item.type === "free_text" && (
              <textarea
                rows={3}
                placeholder="Write your answer…"
                value={freeTextAnswers[item.id] ?? ""}
                onChange={(e) => {
                  setFreeTextAnswers((prev) => ({
                    ...prev,
                    [item.id]: e.target.value,
                  }));
                  if (e.target.value.trim()) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      [item.id]: false,
                    }));
                  }
                }}
                className={`w-full px-3 py-2 rounded-lg border bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 resize-none focus:outline-none focus:ring-2 transition-colors ${
                  hasError
                    ? "border-red-300 dark:border-red-700 focus:ring-red-400/50"
                    : "border-slate-200 dark:border-slate-700 focus:ring-primary/50"
                }`}
              />
            )}
          </div>
        );
      })}

      {submitError && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 dark:bg-red-900/20 px-4 py-3 rounded-xl border border-red-200 dark:border-red-800/30">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {submitError}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-white font-bold text-sm uppercase tracking-widest hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          "Submit Quiz"
        )}
      </button>

      {quiz.maxAttempts !== null && (
        <p className="text-center text-xs text-slate-400">
          {attemptsLeft !== null
            ? `${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining`
            : `${quiz.maxAttempts} attempt${quiz.maxAttempts !== 1 ? "s" : ""} max`}
        </p>
      )}
    </div>
  );
}

// ─── LessonViewer ─────────────────────────────────────────────────────────────

export default function LessonViewer({
  lesson,
  userId,
  courseName,
  moduleName,
}: {
  lesson: Lesson;
  userId?: string;
  courseName?: string;
  moduleName?: string;
}) {
  const searchParams = useSearchParams();
  const params = useParams();
  const router = useRouter();
  const programId = params.programId as string;
  const cohortId = searchParams.get("cohortId");
  const [isCompleted, setIsCompleted] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomMarkerRef = useRef<HTMLDivElement>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [showLectureList, setShowLectureList] = useState(false);
  const [module, setModule] = useState<ModuleData | null>(null);
  const [moduleLoading, setModuleLoading] = useState(true);
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);
  const [activeTrack, setActiveTrack] = useState<LessonVideoTrack | null>(() =>
    resolveDefaultTrack(lesson.videos ?? [])
  );

  const [showLeadModal, setShowLeadModal] = useState(false);
  const [pendingSetPasswordAfterCapture, setPendingSetPasswordAfterCapture] = useState(false);
  const [setPasswordLead, setSetPasswordLead] = useState<{
    email: string;
    name?: string;
  } | null>(null);

  // 1. Ref that tracks whether analytics was already sent for this lesson
  const trackRef = useRef<string | null>(null);
  const setPasswordDismissKey = useMemo(
    () => `lesson-set-password-dismissed:${lesson.id}`,
    [lesson.id]
  );

  useEffect(() => {
    if (userId) {
      setShowLeadModal(false);
      setSetPasswordLead(null);
      return;
    }

    const leadEmail = readLeadEmailCookie(document.cookie);
    if (!leadEmail) {
      setShowLeadModal(true);
      setSetPasswordLead(null);
      return;
    }

    setShowLeadModal(false);

    const isDismissed = sessionStorage.getItem(setPasswordDismissKey) === "1";
    if (!isDismissed) {
      setSetPasswordLead({
        email: leadEmail,
        name: readLeadNameCookie(document.cookie) ?? undefined,
      });
    }

    // Block the double call (Strict Mode workaround)
    if (trackRef.current === lesson.id) return;

    // Keep the legacy silent lesson-view tracking for known leads.
    trackRef.current = lesson.id;
    fetch("/api/download-contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "LESSON_VIEW",
            email: leadEmail,
            lessonId: lesson.id,
            lessonTitle: lesson.name,
            courseName,
            moduleName,
            isCookieTracking: true,
          }),
          signal: AbortSignal.timeout(10_000),
        })
      .then((response) => {
        if (!response.ok) {
          trackRef.current = null;
          console.error("Tracking error:", response.status, response.statusText);
        }
      })
      .catch((err) => {
        trackRef.current = null;
        console.error("Tracking error:", err);
      });
  }, [courseName, lesson.id, lesson.name, moduleName, setPasswordDismissKey, userId]);

  const dismissSetPasswordModal = useCallback(() => {
    sessionStorage.setItem(setPasswordDismissKey, "1");
    setSetPasswordLead(null);
  }, [setPasswordDismissKey]);

  // First-time visitor who just cleared the blocking LeadCaptureModal: don't
  // stack the set-password prompt right on top of it. Offer it a few seconds
  // after they've actually started consuming the lesson instead.
  useEffect(() => {
    if (!pendingSetPasswordAfterCapture) return;
    if (sessionStorage.getItem(setPasswordDismissKey) === "1") return;

    const timer = setTimeout(() => {
      const leadEmail = readLeadEmailCookie(document.cookie);
      if (!leadEmail) return;
      setSetPasswordLead({
        email: leadEmail,
        name: readLeadNameCookie(document.cookie) ?? undefined,
      });
      setPendingSetPasswordAfterCapture(false);
    }, 8000);

    return () => clearTimeout(timer);
  }, [pendingSetPasswordAfterCapture, setPasswordDismissKey]);

  const parsedTimecodes = parseTimecodes(lesson.timecodes ?? "");
  const parsedTags = (lesson.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const availableVideoTracks = lesson.videos ?? [];
  const resolvedVideoUrl = activeTrack?.videoUrl ?? lesson.videoUrl;
  const shouldShowLanguageSwitcher = availableVideoTracks.length > 1;

  const hasTimecodes = parsedTimecodes.length > 0;
  const hasAudio = !!lesson.audioUrl;
  const hasCaptions = !!lesson.captionsUrl;
  const hasQuiz = !!lesson.quiz && lesson.quiz.items.length > 0;
  const hasSupplementary = hasAudio || hasCaptions || hasQuiz;

  // Flat sorted list of lessons and assessments for prev/next
  const { prevLesson, nextLesson } = useMemo<{
    prevLesson: NavItem | null;
    nextLesson: NavItem | null;
  }>(() => {
    if (!module) return { prevLesson: null, nextLesson: null };

    const allItems: (NavItem & { order: number })[] = [
      ...(module.lessons ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        order: l.order,
      })),
      ...(module.assessments ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        type: "assessment" as const,
        order: a.order,
      })),
    ].sort((a, b) => a.order - b.order);

    const idx = allItems.findIndex((item) => item.id === lesson.id);
    if (idx === -1) return { prevLesson: null, nextLesson: null };

    return {
      prevLesson: idx > 0 ? allItems[idx - 1] : null,
      nextLesson: idx < allItems.length - 1 ? allItems[idx + 1] : null,
    };
  }, [module, lesson.id]);

  useEffect(() => {
    if (!lesson?.moduleId) return;
    setModuleLoading(true);
    fetch(`/api/modules/${lesson.moduleId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ModuleData | null) => {
        if (data) setModule(data);
      })
      .catch(console.error)
      .finally(() => setModuleLoading(false));
  }, [lesson?.moduleId]);

  const markLessonComplete = useCallback(async () => {
    if (isCompleted || !lesson?.id) return;
    try {
      const res = await fetch(`/api/lessons/${lesson.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohortId: cohortId || undefined }),
      });
      if (res.ok) setIsCompleted(true);
    } catch (error) {
      console.error("Failed to mark lesson as complete:", error);
    }
  }, [isCompleted, lesson?.id, cohortId]);

  useEffect(() => {
    if (
      (lesson?.type === "text" || !resolvedVideoUrl) &&
      bottomMarkerRef.current
    ) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) markLessonComplete();
        },
        { threshold: 0.1 }
      );
      observer.observe(bottomMarkerRef.current);
      return () => observer.disconnect();
    }
  }, [lesson?.type, resolvedVideoUrl, markLessonComplete]);

  useEffect(() => {
    if (lesson?.type === "video" && videoProgress >= 99) markLessonComplete();
  }, [videoProgress, lesson?.type, markLessonComplete]);

  const handleTimecodeClick = (seconds: number) => {
    videoPlayerRef.current?.seekTo(seconds);
  };

  useEffect(() => {
    if (showLectureList) {
      document.documentElement.classList.add("overflow-hidden");
    } else {
      document.documentElement.classList.remove("overflow-hidden");
    }
    return () => {
      document.documentElement.classList.remove("overflow-hidden");
    };
  }, [showLectureList]);

  return (
    <>
    <div
      className={`max-w-6xl mx-auto space-y-4 sm:space-y-6 transition-all duration-500 ${showLeadModal ? "blur-md pointer-events-none select-none h-[70vh] overflow-hidden" : "animate-fade-in"}`}
      ref={contentRef}
    >
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{lesson.name}</h1>
      {/* ── Video + Timecodes ── */}
      {lesson.type === "video" && resolvedVideoUrl && (
        <div
          className={`flex flex-col ${hasTimecodes ? "lg:flex-row" : ""} gap-4 sm:gap-6`}
        >
          <div
            className={`${hasTimecodes ? "lg:flex-1 lg:min-w-0" : "w-full max-w-4xl mx-auto"}`}
          >
            <div className="bg-black sm:rounded-3xl overflow-hidden shadow-2xl border-y sm:border border-slate-200 dark:border-slate-800">
              <VideoPlayer
                key={`lesson-video:${lesson.id}:${resolvedVideoUrl}`}
                ref={videoPlayerRef}
                url={resolvedVideoUrl}
                poster={lesson.posterUrl ?? undefined}
                onProgress={setVideoProgress}
              />
            </div>

            {shouldShowLanguageSwitcher && (
              <div className="mt-3 flex items-center justify-end">
                <div
                  aria-label="Video language selector"
                  className="inline-flex items-stretch gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm"
                >
                  {availableVideoTracks.map((track) => {
                    const isActive = activeTrack?.language === track.language;
                    return (
                      <button
                        key={track.language}
                        type="button"
                        aria-pressed={isActive}
                        className={`min-h-[44px] rounded-xl px-3 text-[10px] font-black uppercase tracking-widest transition-colors ${
                          isActive
                            ? "bg-primary text-white"
                            : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                        }`}
                        onClick={() => setActiveTrack(track)}
                      >
                        {track.language.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {lesson.intro && (
              <div className="mt-4 bg-white dark:bg-slate-900 sm:rounded-2xl border-y sm:border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6">
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-sm sm:text-base">
                  {lesson.intro}
                </p>
              </div>
            )}
          </div>

          {hasTimecodes && (
            <TimecodesPanel
              timecodes={parsedTimecodes}
              onTimecodeClick={handleTimecodeClick}
            />
          )}
        </div>
      )}

      {/* ── Bottom Navigation Bar ── */}
      <div className="max-w-6xl mx-auto">
        <BottomNavBar
          prev={prevLesson}
          next={nextLesson}
          programId={programId}
          cohortId={cohortId}
          loading={moduleLoading}
          onLecturesClick={() => setShowLectureList(true)}
        />
      </div>


      {/* ── Supplementary ── */}
      {hasSupplementary && (
        <div className="max-w-4xl mx-auto bg-white dark:bg-slate-900 sm:rounded-3xl border-y sm:border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
          {hasAudio && (
            <CollapsibleSection
              icon={<Headphones className="h-4 w-4" />}
              title="Audio Version"
            >
              <AudioPlayer url={lesson.audioUrl!} />
            </CollapsibleSection>
          )}

          {hasCaptions && (
            <CollapsibleSection
              icon={<ScrollText className="h-4 w-4" />}
              title="Text Version"
            >
              <TextVersion url={lesson.captionsUrl!} />
            </CollapsibleSection>
          )}

          {hasQuiz && (
            <CollapsibleSection
              icon={<BrainCircuit className="h-4 w-4" />}
              title={lesson.quiz!.name ?? "Quiz"}
              badge={`${lesson.quiz!.items.length} question${lesson.quiz!.items.length !== 1 ? "s" : ""}`}
            >
              <QuizBlock quiz={lesson.quiz!} userId={userId} />
            </CollapsibleSection>
          )}
        </div>
      )}

      {/* ── Main content card ── */}
      <div className="bg-white dark:bg-slate-900 sm:rounded-3xl border-y sm:border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-8 md:p-12 space-y-6 sm:space-y-8 max-w-4xl mx-auto">
        <div className="flex items-start gap-3 sm:gap-4">
          <div
            className={`shrink-0 w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center ${
              lesson.type === "video"
                ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500"
                : "bg-primary/10 text-primary"
            }`}
          >
            {lesson.type === "video" ? (
              <Video className="h-5 w-5 sm:h-7 sm:w-7" />
            ) : (
              <FileText className="h-5 w-5 sm:h-7 sm:w-7" />
            )}
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight leading-tight">
              {lesson.name}
            </h1>
            <div className="flex items-center gap-3 mt-1.5 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <span>{formatDuration(lesson.duration)}</span>
              <span>•</span>
              <span>Study Material</span>
            </div>
          </div>
        </div>

        <div
          className="prose prose-base sm:prose-lg prose-slate dark:prose-invert max-w-none pt-2
            prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tighter
            prose-p:leading-loose prose-p:text-slate-600 dark:prose-p:text-slate-400
            prose-strong:text-slate-900 dark:prose-strong:text-white
            prose-a:text-primary hover:prose-a:text-primary-dark
            prose-li:text-slate-600 dark:prose-li:text-slate-400
            prose-code:text-sm prose-code:px-1 prose-code:py-0.5 prose-code:rounded"
          dangerouslySetInnerHTML={{
            __html:
              lesson.text ??
              '<p class="text-slate-400 italic">This lesson has no written content yet.</p>',
          }}
        />

                <div className="pt-6 sm:pt-8 border-t border-slate-100 dark:border-slate-800 flex flex-col items-center gap-4">
          {isCompleted ? (
            <div className="flex items-center gap-2 text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-900/20 px-6 py-3 rounded-full border border-emerald-100 dark:border-emerald-800/30 shadow-sm">
              <CheckCircle className="h-5 w-5" />
              Lesson Completed
            </div>
          ) : lesson.type === "video" ? (
            <div className="text-slate-500 font-semibold text-center">
              <div className="mb-2">
                Watch until the end to complete this lesson
              </div>
              <div className="text-sm text-slate-400">
                {Math.round(videoProgress)}% watched
              </div>
            </div>
          ) : (
            <div className="text-slate-500 font-semibold text-center">
              <div className="mb-2">
                Scroll to the bottom to complete this lesson
              </div>
            </div>
          )}

          {cohortId ? (
            <Link
              href={`/cohorts/${cohortId}`}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-widest bg-primary text-white hover:bg-primary/90 transition-all"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Cohort
            </Link>
          ) : (
            <Link
              href={`/courses/${programId}`}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-widest bg-primary text-white hover:bg-primary/90 transition-all"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Course
            </Link>
          )}
        </div>

        <div ref={bottomMarkerRef} className="h-1" />
      </div>

      {/* ── Tags ── */}
      {parsedTags.length > 0 && (
        <div className="max-w-4xl mx-auto bg-white dark:bg-slate-900 sm:rounded-2xl border-y sm:border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="h-4 w-4 text-slate-400" />
            <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              Tags
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {parsedTags.map((tag, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
              >
                <Tag className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

            {/* ── Lectures Modal ── */}
      {showLectureList && module && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {module.name}
              </h2>
              <button
                onClick={() => setShowLectureList(false)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {module.lessons?.map((lec) => (
                  <Link
                    key={lec.id}
                    href={
                      cohortId
                        ? `/courses/${programId}/${lec.id}?cohortId=${cohortId}`
                        : `/courses/${programId}/${lec.id}`
                    }
                    onClick={() => setShowLectureList(false)}
                    className={`flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                      lec.id === lesson.id ? "bg-primary/10 dark:bg-primary/5" : ""
                    }`}
                  >
                    <div
                      className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                        lec.type === "video"
                          ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {lec.type === "video" ? "🎬" : "📄"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          lec.id === lesson.id
                            ? "text-primary font-bold"
                            : "text-slate-900 dark:text-white"
                        }`}
                      >
                        {lec.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatDuration(lec.duration)}
                      </p>
                    </div>
                  </Link>
                ))}

                {(module.assessments?.length ?? 0) > 0 && (
                  <>
                    <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/30 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Assessments
                    </div>
                    {module.assessments!.map((ass) => (
                      <Link
                        key={ass.id}
                        href={
                          cohortId
                            ? `/courses/${programId}/${ass.id}?cohortId=${cohortId}`
                            : `/courses/${programId}/${ass.id}`
                        }
                        onClick={() => setShowLectureList(false)}
                        className={`flex items-start gap-3 p-4 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors ${
                          ass.id === lesson.id
                            ? "bg-amber-100/30 dark:bg-amber-900/20"
                            : ""
                        }`}
                      >
                        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                          ✏️
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              ass.id === lesson.id
                                ? "text-amber-600 font-bold"
                                : "text-slate-900 dark:text-white"
                            }`}
                          >
                            {ass.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Assessment
                          </p>
                        </div>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>

    {/* The lead modal must render outside the blurred container */}
    <LeadCaptureModal
      isOpen={showLeadModal}
      onClose={() => {}} // Blocking modal, cannot be closed
      type="LESSON_VIEW"
      metadata={{ 
        lessonId: lesson.id, 
        lessonTitle: lesson.name,
        courseName,
        moduleName
      }}
      onSuccess={(email) => {
        setShowLeadModal(false);
        // They just handed us name+email through the blocking modal — offer
        // the set-password prompt shortly, not stacked on its dismissal.
        setPendingSetPasswordAfterCapture(true);
      }}
    />
    <SetPasswordModal
      isOpen={!!setPasswordLead}
      email={setPasswordLead?.email ?? null}
      name={setPasswordLead?.name}
      onDismiss={dismissSetPasswordModal}
      onSuccess={() => {
        dismissSetPasswordModal();
        router.refresh();
      }}
    />
    </>
  );
}
