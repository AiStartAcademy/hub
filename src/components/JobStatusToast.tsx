"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CheckCircle2, XCircle, Loader2, X, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string | null;
  error: string | null;
  resultUrl: string | null;
}

interface Props {
  jobId: string;
  label: string;
  onDismiss: () => void;
}

export function JobStatusToast({ jobId, label, onDismiss }: Props) {
  const [job, setJob] = useState<Job | null>(null);
  const router = useRouter();
  const stoppedRef = useRef(false);
  const refreshedRef = useRef(false);

  const poll = useCallback(async () => {
    if (stoppedRef.current) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const data: Job = await res.json();
      setJob(data);

      if (data.status === "done" || data.status === "failed") {
        stoppedRef.current = true;
        // Refresh page data once so the new duplicate appears in the list
        if (data.status === "done" && !refreshedRef.current) {
          refreshedRef.current = true;
          router.refresh();
        }
      }
    } catch {
      // silent — will retry on next tick
    }
  }, [jobId, router]);

  useEffect(() => {
    stoppedRef.current = false;
    refreshedRef.current = false;

    poll();
    const interval = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(interval);
        return;
      }
      poll();
    }, 2000);

    return () => clearInterval(interval);
  }, [poll]);

  const isDone = job?.status === "done";
  const isFailed = job?.status === "failed";
  const isRunning = !isDone && !isFailed;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning && <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />}
          {isDone && <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
          {isFailed && <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
          <span className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{label}</span>
        </div>
        {/* Always show close button so user can dismiss at any time */}
        <button
          onClick={onDismiss}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors flex-shrink-0 ml-2"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full transition-all duration-500 ${
            isDone ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-primary"
          }`}
          style={{ width: `${job?.progress ?? 0}%` }}
        />
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isFailed
            ? (job?.error ?? "An error occurred")
            : isDone
            ? (job?.message ?? "Completed successfully")
            : (job?.message ?? "Initializing...")}
        </p>

        {isDone && job?.resultUrl && (
          <button
            onClick={() => {
              router.push(job.resultUrl!);
              onDismiss();
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Go to result
          </button>
        )}
      </div>
    </div>
  );
}