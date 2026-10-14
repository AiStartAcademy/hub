"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Star, Check } from "lucide-react";

interface Props {
  availableDates: string[];
  currentDate: string;
  onDateSelect: (date: string) => void;
  onSetAsCurrent: (date: string) => void;
  onClose: () => void;
}

export function CompactCalendar({
  availableDates,
  currentDate,
  onDateSelect,
  onSetAsCurrent,
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [viewMonth, setViewMonth] = useState(() => {
    const ref = currentDate || availableDates[0] || new Date().toISOString().slice(0, 10);
    const d = new Date(ref + "T00:00:00");
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const [settingCurrent, setSettingCurrent] = useState<string | null>(null);

  const dateSet = useMemo(() => new Set(availableDates), [availableDates]);

  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const firstDay = new Date(viewMonth.year, viewMonth.month, 1).getDay();

  const monthLabel = new Date(viewMonth.year, viewMonth.month).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  const prevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewMonth((v) => {
      const m = v.month - 1;
      return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m };
    });
  };

  const nextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewMonth((v) => {
      const m = v.month + 1;
      return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m };
    });
  };

  const toISO = (day: number) => {
    const mm = String(viewMonth.month + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${viewMonth.year}-${mm}-${dd}`;
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleSetCurrent = async (date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSettingCurrent(date);
    await onSetAsCurrent(date);
    setTimeout(() => setSettingCurrent(null), 1200);
  };

  return (
    <div
      ref={containerRef}
      className="w-[300px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl shadow-black/20 dark:shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-2 bg-gradient-to-b from-indigo-50/50 to-transparent dark:from-indigo-900/20">
        <div className="flex items-center justify-between">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {monthLabel}
          </h3>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Day headers ── */}
      <div className="grid grid-cols-7 gap-0.5 px-3 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={`${d}-${i}`}
            className="text-center text-[9px] font-black text-slate-400 dark:text-slate-600 py-0.5 uppercase tracking-wider"
          >
            {d}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      <div className="grid grid-cols-7 gap-0.5 px-3 pb-3">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const iso = toISO(day);
          const hasData = dateSet.has(iso);
          const isSelected = iso === currentDate;

          return (
            <button
              key={day}
              disabled={!hasData}
              onClick={() => hasData && onDateSelect(iso)}
              className={`
                aspect-square flex items-center justify-center rounded-md text-[11px] font-medium transition-all relative
                ${isSelected ? "bg-indigo-600 text-white font-bold shadow-sm shadow-indigo-500/30" : ""}
                ${!isSelected && hasData ? "text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 font-semibold" : ""}
                ${!hasData ? "text-slate-300 dark:text-slate-700 cursor-default" : "cursor-pointer"}
              `}
            >
              {day}
              {hasData && !isSelected && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-indigo-400 dark:bg-indigo-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Footer: set current date ── */}
      {currentDate && (
        <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 font-semibold uppercase tracking-wider">
            Viewing{" "}
            <strong className="text-slate-700 dark:text-slate-300">
              {new Date(currentDate + "T00:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </strong>
          </p>
          <button
            onClick={(e) => handleSetCurrent(currentDate, e)}
            disabled={settingCurrent === currentDate}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-emerald-600 text-white text-[11px] font-bold rounded-lg transition-all uppercase tracking-wider"
          >
            {settingCurrent === currentDate ? (
              <>
                <Check className="h-3 w-3" />
                Set current
              </>
            ) : (
              <>
                <Star className="h-3 w-3" />
                Set as current for students
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}