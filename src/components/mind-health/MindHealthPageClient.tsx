"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, AlertCircle, Calendar, Target, Zap } from "lucide-react";
import type { MindHealthResponse } from "@/types/mind-health";
import { DeepSetViewer } from "./DeepSetViewer";
import { ArithmeticBlockViewer } from "../mind-health/ArithmeticBlockViewer";
import { CompactCalendar } from "./CompactCalendar";
import { MobileMenuButton } from "@/components/MobileMenuButton";
import { hasAnyRole } from "@/lib/roles";

interface Props {
  initialRole: string;
}

export function MindHealthPageClient({ initialRole }: Props) {
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState<MindHealthResponse | null>(null);
  const [currentDate, setCurrentDate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const canManage = hasAnyRole(initialRole, ["INSTRUCTOR", "ADMIN"]);
  const isStudentView = canManage && response && currentDate !== getLatestDate(response);

  const fetchMindHealth = useCallback(async (date?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/mind-health${params}`);
      if (!res.ok) throw new Error("Failed to load exercises");
      const data: MindHealthResponse = await res.json();
      setResponse(data);
      setCurrentDate(data.currentDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMindHealth();
  }, [fetchMindHealth]);

  const handleDateChange = (date: string) => {
    setCurrentDate(date);
    setCalendarOpen(false);
    fetchMindHealth(date);
  };

  const handleSetCurrentDate = async (date: string) => {
    try {
      await fetch("/api/admin/mind-health", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
    } catch (err) {
      console.error("[MindHealth] Failed to set current date:", err);
    }
  };

  if (loading && !response) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#0B0F17]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="animate-pulse space-y-8">
            <div className="h-12 w-64 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-40 bg-slate-200 dark:bg-slate-800 rounded-3xl" />
            <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 dark:bg-[#0B0F17]">
        <div className="max-w-md text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-red-100 dark:bg-red-900/20 text-red-500 shadow-sm border border-red-200 dark:border-red-900/30">
            <AlertCircle className="h-8 w-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">System Error</h2>
            <p className="text-slate-500 dark:text-slate-400 text-base mt-2">{error}</p>
          </div>
          <button
            onClick={() => fetchMindHealth(currentDate)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:scale-105 transition-transform"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!response?.data) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 dark:bg-[#0B0F17]">
        <div className="max-w-md text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 border border-indigo-100 dark:border-indigo-900/20">
            <Brain className="h-8 w-8" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">No Exercises Yet</h2>
            <p className="text-slate-500 dark:text-slate-400 text-base mt-2">
              The neural pathways are quiet today. Check back later!
            </p>
          </div>
        </div>
      </div>
    );
  }

  const formattedDate = new Date(response.data.meta.date + "T00:00:00").toLocaleDateString(
    "en-US",
    { weekday: 'long', month: "long", day: "numeric" }
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#0B0F17]">
      {/* max-w-5xl for extra room */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-12">
        
        {/* ── Hero Header ── */}
        <header className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 md:gap-4">
              <div className="mt-1 md:hidden">
                <MobileMenuButton />
              </div>
              <div>
                <p className="text-sm sm:text-base font-bold text-indigo-600 dark:text-indigo-400 tracking-widest uppercase mb-2">
                  Mind Health Protocol
                </p>
                <h1 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tight mb-2">
                  {formattedDate}
                </h1>
                {canManage && (
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    Week {response.data.meta.week_number} Sequence
                  </p>
                )}
              </div>
            </div>

            {canManage && response.availableDates.length > 0 && (
              <Relative>
                <PopoverTrigger>
                  <button
                    onClick={() => setCalendarOpen((v) => !v)}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 min-h-[44px] ${
                      isStudentView
                        ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20 hover:bg-rose-100 dark:hover:bg-rose-500/20 focus-visible:ring-rose-500"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 focus-visible:ring-slate-500"
                    }`}
                  >
                    <Calendar className="h-4 w-4" />
                    <span className="uppercase tracking-wider">
                      {isStudentView ? "Previewing" : "History"}
                    </span>
                  </button>
                </PopoverTrigger>
                {calendarOpen && (
                  <PopoverContent>
                    <CompactCalendar
                      availableDates={response.availableDates}
                      currentDate={currentDate}
                      onDateSelect={handleDateChange}
                      onSetAsCurrent={handleSetCurrentDate}
                      onClose={() => setCalendarOpen(false)}
                    />
                  </PopoverContent>
                )}
              </Relative>
            )}
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2 text-sm bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
              <Target className="h-4 w-4 text-indigo-500" />
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {response.data.meta.focus_category}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {response.data.meta.memory_technique}
              </span>
            </div>
          </div>
        </header>

        {/* ── Content Stream ── */}
        <div className="space-y-12">
          {response.data.deep_set.arithmetic_block && (
            <ArithmeticBlockViewer block={response.data.deep_set.arithmetic_block} />
          )}

          <DeepSetViewer
            deepSet={response.data.deep_set}
            meta={response.data.meta}
            loading={loading}
          />
        </div>

      </div>
    </div>
  );
}

// ─── Primitives ──────────────
function Relative({ children }: { children: React.ReactNode }) { return <div className="relative">{children}</div>; }
function PopoverTrigger({ children }: { children: React.ReactNode }) { return <>{children}</>; }
function PopoverContent({ children }: { children: React.ReactNode }) {
  return <div className="absolute right-0 top-full mt-2 z-40">{children}</div>;
}
function getLatestDate(response: MindHealthResponse): string {
  return response.availableDates[0] ?? response.currentDate;
}