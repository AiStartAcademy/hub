'use client';

import { useState } from "react";
import { BookOpen, LayoutList, Lock, ChevronDown } from "lucide-react";

interface CourseOverviewCardProps {
  name: string;
  description: string | null;
  status: string;
  isLocked: boolean;
  moduleCount: number;
}

export function CourseOverviewCard({
  name,
  description,
  status,
  isLocked,
  moduleCount,
}: CourseOverviewCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const descriptionText = description || "No description provided for this program.";
  const preview = descriptionText.slice(0, 120).trimEnd();
  const hasMore = descriptionText.length > 120;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:shadow-md overflow-hidden">
      {/* Always-visible header — clickable */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center gap-4 p-6 sm:p-8 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
        aria-expanded={isOpen}
        aria-controls="course-overview-body"
      >
        <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <BookOpen className="h-6 w-6" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Course Overview
            </h2>
            {/* Chevron indicator */}
            <ChevronDown
              className={`h-5 w-5 text-slate-400 flex-shrink-0 transition-transform duration-300 group-hover:text-primary ${
                isOpen ? "rotate-180" : "rotate-0"
              }`}
            />
          </div>

          {/* Meta badges */}
          <div className="flex items-center flex-wrap gap-3 mt-1.5 text-sm text-slate-500 font-medium">
            <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md uppercase text-[10px] tracking-wider text-slate-600 dark:text-slate-400">
              {status}
            </span>
            {isLocked && (
              <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md text-[10px] tracking-wider text-slate-600 dark:text-slate-400">
                <Lock className="h-3 w-3" />
                Locked
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <LayoutList className="h-4 w-4" />
              {moduleCount} Modules
            </span>
          </div>

          {/* Collapsed preview with fade */}
          {!isOpen && (
            <div className="relative mt-2 max-h-[3rem] overflow-hidden">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                {preview}
                {hasMore && "…"}
              </p>
            </div>
          )}
        </div>
      </button>

      {/* Collapsible body */}
      <div
        id="course-overview-body"
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-6 sm:px-8 pb-6 sm:pb-8 pt-0">
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed max-w-3xl">
                {descriptionText}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}