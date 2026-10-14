"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, BookOpen, Check } from "lucide-react";

interface Course {
  id: string;
  name: string;
}

interface Props {
  currentProgramId: string;
  onSelect: (programId: string, programName: string) => void;
  onClose: () => void;
}

export function MoveToCourseModal({ currentProgramId, onSelect, onClose }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetch("/api/programs/tree")
      .then((r) => r.json())
      .then((data: Course[]) => setCourses(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = courses.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Move to Course</h3>
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
              placeholder="Search courses..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary dark:bg-slate-800 dark:text-white transition-all"
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
              Loading courses...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
              No courses found
            </div>
          ) : (
            filtered.map((course) => {
              const isCurrent = course.id === currentProgramId;
              return (
                <button
                  key={course.id}
                  onClick={() => !isCurrent && onSelect(course.id, course.name)}
                  disabled={isCurrent}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isCurrent
                      ? "opacity-50 cursor-not-allowed bg-slate-50 dark:bg-slate-800/50"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <BookOpen className="h-4 w-4 text-primary/60 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex-1 truncate">
                    {course.name}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      current
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}