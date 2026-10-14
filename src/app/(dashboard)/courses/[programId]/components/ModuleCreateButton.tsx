"use client";

import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { createModule, triggerN8nWebhook } from "../../actions";
import { useRouter } from "next/navigation";

interface Props {
  program: {
    id: string;
    name: string;
  };
}

export function ModuleCreateButton({ program }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [googleDriveUrl, setGoogleDriveUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const module = await createModule(program.id, { name, description });

      // Send to n8n when a Google Drive URL is given
      if (googleDriveUrl.trim()) {
        try {
          await triggerN8nWebhook({
            programName: program.name,
            moduleName: module.name,
            moduleId: module.id,
            googleDriveUrl: googleDriveUrl.trim(),
          });
        } catch (err) {
          console.error(err);
          alert("Something went wrong while creating the module. Please try again.");
        }
      }

      setOpen(false);
      setName("");
      setDescription("");
      setGoogleDriveUrl("");
      router.refresh();
    } catch (err) {
      console.error(err);
      alert("Failed to create module");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary-dark transition-colors shadow-sm flex items-center gap-2"
      >
        <Plus className="h-4 w-4" />
        Add Module
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Create New Module
              </h3>

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
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Google Drive Folder URL
                  <span className="text-slate-400 ml-1 font-normal">(optional)</span>
                </label>
                <input
                  type="url"
                  value={googleDriveUrl}
                  onChange={(e) => setGoogleDriveUrl(e.target.value)}
                  disabled={loading}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
                />
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Leave empty to add lessons manually later
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary-dark rounded-lg disabled:opacity-50 flex items-center gap-2"
                >
                  <Send className="h-3.5 w-3.5" />
                  {loading ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}