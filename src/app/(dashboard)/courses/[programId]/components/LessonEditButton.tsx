"use client";

import { useState, useRef, useEffect } from "react";
import { Edit2, Trash2, Copy, MoveRight, Loader2, MoreVertical } from "lucide-react";
import { updateLesson, deleteLesson } from "../../actions";
import { useRouter } from "next/navigation";
import { MoveToModuleModal } from "@/components/MoveToModuleModal";

interface LessonMeta {
  id: string;
  name: string;
  duration: number | null;
  type: string;
  moduleId: string;
}

export function LessonEditButton({ lesson }: { lesson: LessonMeta }) {
  const [open, setOpen] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [name, setName] = useState(lesson.name);
  const [duration, setDuration] = useState(lesson.duration ?? 0);
  const [type, setType] = useState(lesson.type);
  const [loading, setLoading] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [moving, setMoving] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close actions dropdown on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const handler = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [actionsOpen]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateLesson(lesson.id, { name, duration, type });
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error("[LessonEditButton] Update failed:", err);
      alert("Failed to update lesson");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this lesson?")) return;
    setLoading(true);
    try {
      await deleteLesson(lesson.id);
      router.refresh();
    } catch (err) {
      console.error("[LessonEditButton] Delete failed:", err);
      alert("Failed to delete lesson");
      setLoading(false);
    }
  };

  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      console.log(`[LessonEditButton] Duplicating lesson ${lesson.id}`);
      const res = await fetch(`/api/lessons/${lesson.id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error);
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error("[LessonEditButton] Duplicate failed:", err);
      alert("Failed to duplicate lesson");
    } finally {
      setDuplicating(false);
    }
  };

  const handleMoveSelect = async (targetModuleId: string) => {
    setMoving(true);
    setShowMoveModal(false);
    try {
      console.log(`[LessonEditButton] Moving lesson ${lesson.id} to module ${targetModuleId}`);
      const res = await fetch(`/api/lessons/${lesson.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetModuleId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      // Navigate to target course if different
      router.push(`/courses/${data.targetProgramId}`);
      router.refresh();
    } catch (err) {
      console.error("[LessonEditButton] Move failed:", err);
      alert("Failed to move lesson");
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1 text-slate-400 hover:text-primary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded flex"
        title="Lesson Settings"
      >
        <Edit2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md border border-slate-200 dark:border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Lesson Settings</h3>
              <div className="flex items-center gap-1">
                <div className="relative" ref={actionsRef}>
                  <button
                    type="button"
                    onClick={() => setActionsOpen((v) => !v)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    title="More actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {actionsOpen && (
                    <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); handleDuplicate(); }}
                        disabled={duplicating || moving}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                      >
                        {duplicating ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        ) : (
                          <Copy className="h-4 w-4 text-slate-400" />
                        )}
                        {duplicating ? "Duplicating..." : "Duplicate Lesson"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); setShowMoveModal(true); }}
                        disabled={duplicating || moving}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                      >
                        {moving ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        ) : (
                          <MoveRight className="h-4 w-4 text-slate-400" />
                        )}
                        {moving ? "Moving..." : "Move to Module"}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                  title="Delete Lesson"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Edit form */}
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none disabled:opacity-50 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    disabled={loading}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none disabled:opacity-50 text-sm"
                  >
                    <option value="text">Text</option>
                    <option value="video">Video</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Duration (sec)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                    disabled={loading}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none disabled:opacity-50 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 rounded-lg transition-all disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMoveModal && (
        <MoveToModuleModal
          currentModuleId={lesson.moduleId}
          onSelect={(moduleId) => handleMoveSelect(moduleId)}
          onClose={() => setShowMoveModal(false)}
        />
      )}
    </>
  );
}