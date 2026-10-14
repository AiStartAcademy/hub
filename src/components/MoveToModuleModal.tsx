"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, BookOpen, LayoutList, ChevronRight } from "lucide-react";

interface ModuleItem {
  id: string;
  name: string;
}

interface CourseWithModules {
  id: string;
  name: string;
  modules: ModuleItem[];
}

interface Props {
  currentModuleId: string;
  onSelect: (moduleId: string, moduleName: string, courseName: string) => void;
  onClose: () => void;
}

export function MoveToModuleModal({ currentModuleId, onSelect, onClose }: Props) {
  const [courses, setCourses] = useState<CourseWithModules[]>([]);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetch("/api/programs/tree")
      .then((r) => r.json())
      .then((data: CourseWithModules[]) => {
        setCourses(data);
        // Auto-expand course that contains the current module
        const parent = data.find((c) =>
          c.modules.some((m) => m.id === currentModuleId)
        );
        if (parent) setExpandedIds(new Set([parent.id]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentModuleId]);

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const searchLower = search.toLowerCase();
  const filtered = courses
    .map((c) => ({
      ...c,
      modules: c.modules.filter(
        (m) =>
          m.name.toLowerCase().includes(searchLower) ||
          c.name.toLowerCase().includes(searchLower)
      ),
    }))
    .filter((c) => c.modules.length > 0 || c.name.toLowerCase().includes(searchLower));

  // When searching — auto-expand all
  const displayedCourses = search
    ? filtered.map((c) => ({ ...c, forceOpen: true }))
    : courses.map((c) => ({ ...c, forceOpen: false }));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Move to Module</h3>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search courses or modules..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary dark:bg-slate-800 dark:text-white transition-all"
            />
          </div>
        </div>

        {/* Tree */}
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
              Loading...
            </div>
          ) : displayedCourses.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
              No results found
            </div>
          ) : (
            displayedCourses.map((course) => {
              const isOpen = course.forceOpen || expandedIds.has(course.id);
              const modulesToShow = search
                ? course.modules.filter(
                    (m) =>
                      m.name.toLowerCase().includes(searchLower) ||
                      course.name.toLowerCase().includes(searchLower)
                  )
                : course.modules;

              return (
                <div key={course.id} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                  {/* Course row */}
                  <button
                    onClick={() => toggle(course.id)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <BookOpen className="h-4 w-4 text-primary/70 flex-shrink-0" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300 flex-1 text-left truncate">
                      {course.name}
                    </span>
                    <ChevronRight
                      className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    />
                  </button>

                  {/* Modules */}
                  {isOpen && (
                    <div className="bg-slate-50/50 dark:bg-slate-800/20">
                      {modulesToShow.length === 0 ? (
                        <p className="px-10 py-2 text-xs text-slate-400">No modules</p>
                      ) : (
                        modulesToShow.map((mod) => {
                          const isCurrent = mod.id === currentModuleId;
                          return (
                            <button
                              key={mod.id}
                              onClick={() => !isCurrent && onSelect(mod.id, mod.name, course.name)}
                              disabled={isCurrent}
                              className={`w-full flex items-center gap-2 px-10 py-2.5 text-left transition-colors ${
                                isCurrent
                                  ? "opacity-50 cursor-not-allowed"
                                  : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                              }`}
                            >
                              <LayoutList className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                              <span className="text-sm text-slate-600 dark:text-slate-400 flex-1 truncate">
                                {mod.name}
                              </span>
                              {isCurrent && (
                                <span className="text-[10px] font-bold text-slate-400 uppercase">
                                  current
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}