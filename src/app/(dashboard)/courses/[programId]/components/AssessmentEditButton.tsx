"use client";

import { useState } from "react";
import { Edit2, Trash2, FileText } from "lucide-react";
import { updateAssessment, deleteAssessment } from "../../actions";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function AssessmentEditButton({ assessment }: { assessment: any }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(assessment.name);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateAssessment(assessment.id, { name });
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to update assessment");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this assessment?")) return;
    setLoading(true);
    try {
      await deleteAssessment(assessment.id);
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to delete assessment");
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1 text-slate-400 hover:text-amber-600 transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/10 rounded flex"
      >
        <Edit2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-amber-50/50 dark:bg-amber-900/10">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Assessment</h3>
              <button 
                onClick={handleDelete}
                className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                title="Delete Assessment"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none"
                />
              </div>
              <div className="pt-2">
                 <Link 
                   href={`/courses/${assessment.module.programId}/${assessment.id}/edit`}
                   className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm font-bold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-all"
                 >
                   <FileText className="h-4 w-4" />
                   Editor Content
                 </Link>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
                <button type="submit" disabled={loading} className="px-4 py-2 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-all disabled:opacity-50">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
