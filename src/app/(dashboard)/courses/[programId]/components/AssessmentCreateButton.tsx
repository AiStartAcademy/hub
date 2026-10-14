"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createAssessment } from "../../actions";
import { useRouter } from "next/navigation";

export function AssessmentCreateButton({ moduleId }: { moduleId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createAssessment(moduleId, { name });
      setOpen(false);
      setName("");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to create assessment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-500/5 transition-all flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
      >
        <Plus className="h-3.5 w-3.5" />
        Assessment
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-amber-50/50 dark:bg-amber-900/10">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Add New Assessment</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none"
                  placeholder="e.g. Module 1 Quiz"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setOpen(false)} 
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={loading} 
                  className="px-4 py-2 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-all disabled:opacity-50 shadow-sm shadow-amber-500/20"
                >
                  {loading ? "Adding..." : "Add Assessment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
