// src/app/(dashboard)/courses/components/CourseListClient.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Clock,
  FileText,
  LayoutList,
  Lock,
  Filter,
  X,
  ShoppingCart,
} from "lucide-react";
import { ShareButton } from "./ShareButton";

type ProgramData = {
  id: string;
  name: string;
  description: string | null;
  cover: string | null;
  status: string;
  accessMode: string;
  locked: boolean;
  updatedAt: Date | string;
  rawCohort?: { title: string } | null;
  modules: {
    lessons: { duration?: number }[];
    assessments: { id: string }[];
  }[];
};

interface CourseListClientProps {
  initialPrograms: ProgramData[];
  canManage: boolean;
  isAuthenticated: boolean;
  accessibleProgramIds: string[];
}

const ALL_STATUSES = ["open", "draft", "raw", "archived"];

// Status label styles for manager view
const MANAGER_STATUS_STYLES: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  archived: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  raw: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

// Access mode labels shown to managers (only for public/auth courses)
const MANAGER_ACCESS_LABEL: Record<string, { text: string; style: string } | null> = {
  public: {
    text: "PUBLIC",
    style: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  },
  auth: {
    text: "AUTH",
    style: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  member: {
    text: "MEMBERS",
    style: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  },
  cohort: null,
  direct: null,
};

type StudentLabelVariant =
  | { type: "my" }
  | { type: "public" }
  | { type: "auth-required" }
  | { type: "members" }
  | { type: "for-sale" };

function resolveStudentLabel(
  programId: string,
  accessMode: string,
  status: string,
  accessibleSet: Set<string>,
  isAuthenticated: boolean
): StudentLabelVariant {
  if (accessibleSet.has(programId)) return { type: "my" };
  if (accessMode === "public") return { type: "public" };
  if (accessMode === "auth") {
    return isAuthenticated ? { type: "public" } : { type: "auth-required" };
  }
  if (accessMode === "member") {
    // Membership is purchasable, but "FOR SALE" misread as buying the course itself —
    // say what actually unlocks it.
    return { type: "members" };
  }
  // cohort/direct open courses without access = for sale
  if (status === "open") return { type: "for-sale" };
  return { type: "for-sale" };
}

function StudentLabel({ variant }: { variant: StudentLabelVariant }) {
  if (variant.type === "my") {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        MY
      </span>
    );
  }

  if (variant.type === "public") {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
        PUBLIC
      </span>
    );
  }

  if (variant.type === "auth-required") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
          PUBLIC
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z"/>
          </svg>
          auth required
        </span>
      </div>
    );
  }

  if (variant.type === "members") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
        <ShoppingCart className="h-3 w-3" />
        AVAILABLE FOR MEMBERS
      </span>
    );
  }

  // for-sale
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
      <ShoppingCart className="h-3 w-3" />
      FOR SALE
    </span>
  );
}

export function CourseListClient({
  initialPrograms,
  canManage,
  isAuthenticated,
  accessibleProgramIds,
}: CourseListClientProps) {
  const defaultStatuses = canManage ? ["open", "draft", "raw"] : ["open", "raw"];
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(defaultStatuses);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  let filteredPrograms = canManage
    ? initialPrograms.filter((p) => selectedStatuses.includes(p.status))
    : initialPrograms;

  const accessibleSet = new Set(accessibleProgramIds);

  if (canManage) {
    // Managers: Active (open/draft) → Raw → Archived
    filteredPrograms = [...filteredPrograms].sort((a, b) => {
      const getWeight = (s: string) => (s === "archived" ? 3 : s === "raw" ? 2 : 1);
      return getWeight(a.status) - getWeight(b.status);
    });
  } else {
    // Students/guests: MY first, then PUBLIC, then auth-required, then for-sale
    const getStudentWeight = (p: ProgramData) => {
      if (accessibleSet.has(p.id)) return 0;
      if (p.accessMode === "public") return 1;
      if (p.accessMode === "auth") return isAuthenticated ? 1 : 2;
      // member/cohort/direct without access all sort last, alongside for-sale.
      return 3;
    };
    filteredPrograms = [...filteredPrograms].sort(
      (a, b) => getStudentWeight(a) - getStudentWeight(b)
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Filters Bar (managers only) ─── */}
      {canManage && (
        <div className="flex items-center justify-end relative">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
              isFilterOpen || selectedStatuses.length < ALL_STATUSES.length
                ? "bg-white dark:bg-slate-900 border-primary text-primary shadow-sm"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm"
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {selectedStatuses.length < ALL_STATUSES.length && (
              <span className="flex items-center justify-center bg-primary text-white text-[10px] h-4 w-4 rounded-full font-bold">
                {selectedStatuses.length}
              </span>
            )}
          </button>

          {isFilterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden animate-fade-in origin-top-right ring-1 ring-black/5">
                <div className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Status
                  </h4>
                  <button
                    onClick={() => setIsFilterOpen(false)}
                    className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="p-2">
                  {ALL_STATUSES.map((status) => (
                    <label
                      key={status}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes(status)}
                        onChange={() => toggleStatus(status)}
                        className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                      />
                      <span className="text-sm font-medium capitalize text-slate-700 dark:text-slate-300">
                        {status}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="p-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <button
                    onClick={() => {
                      setSelectedStatuses(ALL_STATUSES);
                      setIsFilterOpen(false);
                    }}
                    className="w-full text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    Reset all
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Grid ─── */}
      {filteredPrograms.length === 0 ? (
        <div className="text-center text-slate-500 py-12 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <BookOpen className="h-12 w-12 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">
            No courses match the selected filters
          </h3>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
          {filteredPrograms.map((prog) => {
            const totalModules = prog.modules.length;
            let totalItems = 0;
            let totalDuration = 0;

            prog.modules.forEach((mod) => {
              totalItems += mod.lessons.length + mod.assessments.length;
              mod.lessons.forEach((l) => {
                totalDuration += l.duration || 0;
              });
            });

            const totalMinutes = Math.floor(totalDuration / 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

            // Manager: access mode badge (only for public/auth courses)
            const managerAccessLabel =
              canManage ? MANAGER_ACCESS_LABEL[prog.accessMode] ?? null : null;

            // Student/guest: single label determined by access mode + enrollment
            const studentLabel = !canManage
              ? resolveStudentLabel(prog.id, prog.accessMode, prog.status, accessibleSet, isAuthenticated)
              : null;

            return (
              <div
                key={prog.id}
                className="group bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-all duration-200 flex flex-col"
              >
                {prog.cover && (
                  <div className="h-40 w-full overflow-hidden bg-slate-200 dark:bg-slate-800">
                    <img
                      src={`/api/programs/${prog.id}/cover?v=${new Date(prog.updatedAt).getTime()}`}
                      alt={prog.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}

                <div className="p-6 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                      <BookOpen className="h-5 w-5" />
                    </div>

                    {/* ─── Labels area ─── */}
                    <div className="flex items-start gap-2">
                      {prog.locked && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          <Lock className="h-3 w-3" />
                          Locked
                        </span>
                      )}

                      {canManage ? (
                        // Manager: status label + optional access label
                        <div className="flex items-center gap-1.5">
                          {managerAccessLabel && (
                            <span
                              className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide ${managerAccessLabel.style}`}
                            >
                              {managerAccessLabel.text}
                            </span>
                          )}
                          <span
                            className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide ${
                              MANAGER_STATUS_STYLES[prog.status] ?? MANAGER_STATUS_STYLES.draft
                            }`}
                          >
                            {prog.status}
                          </span>
                        </div>
                      ) : (
                        // Student/guest: single access label
                        studentLabel && <StudentLabel variant={studentLabel} />
                      )}
                    </div>
                  </div>

                  <Link href={`/courses/${prog.id}`} className="block">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2 group-hover:text-primary transition-colors">
                      {prog.name}
                    </h3>
                  </Link>
                  <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-6 min-h-[40px]">
                    {prog.description || "No description provided."}
                  </p>

                  <div className="grid grid-cols-3 gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                    <div className="flex flex-col items-center justify-center text-center">
                      <LayoutList className="h-4 w-4 text-slate-400 mb-1" />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {totalModules}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Modules
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center text-center border-l border-r border-slate-100 dark:border-slate-800">
                      <FileText className="h-4 w-4 text-slate-400 mb-1" />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {totalItems}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Items
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center text-center">
                      <Clock className="h-4 w-4 text-slate-400 mb-1" />
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {durationText}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Length
                      </span>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <Link
                    href={`/courses/${prog.id}`}
                    className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    View Course →
                  </Link>
                  <ShareButton programId={prog.id} programName={prog.name} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
