"use client";

import { useState, useRef, useEffect } from "react";
import { Edit2, Trash2, Copy, MoveRight, Send, Loader2, MoreVertical } from "lucide-react";
import { updateModule, deleteModule, triggerN8nWebhook } from "../../actions";
import { useRouter } from "next/navigation";
import { MoveToCourseModal } from "@/components/MoveToCourseModal";
import { JobStatusToast } from "@/components/JobStatusToast";

interface ModuleData {
  id: string;
  name: string;
  description: string | null;
  programId: string;
  program: { id: string; name: string };
}

interface ProgramOption {
  id: string;
  name: string;
}

interface Props {
  module: ModuleData;
  programs: ProgramOption[];
}

export function ModuleEditButton({ module, programs }: Props) {
  const [open, setOpen] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [redirectDialogOpen, setRedirectDialogOpen] = useState(false);
  const [movedToProgramId, setMovedToProgramId] = useState<string | null>(null);
  const [movedToProgramName, setMovedToProgramName] = useState<string | null>(null);
  const [name, setName] = useState(module.name);
  const [description, setDescription] = useState(module.description || "");
  const [googleDriveUrl, setGoogleDriveUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [duplicateJobId, setDuplicateJobId] = useState<string | null>(null);
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
      await updateModule(module.id, { name, description });
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error("[ModuleEditButton] Update failed:", err);
      alert("Failed to update module");
    } finally {
      setLoading(false);
    }
  };

  const handleMoveSelect = async (targetProgramId: string, targetProgramName: string) => {
    setShowMoveModal(false);
    setMoving(true);
    try {
      console.log(`[ModuleEditButton] Moving module ${module.id} to program ${targetProgramId}`);
      const res = await fetch(`/api/modules/${module.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetProgramId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setOpen(false);
      setMovedToProgramId(targetProgramId);
      setMovedToProgramName(targetProgramName);
      setRedirectDialogOpen(true);
    } catch (err) {
      console.error("[ModuleEditButton] Move failed:", err);
      alert("Failed to move module");
    } finally {
      setMoving(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      console.log(`[ModuleEditButton] Starting module duplication for ${module.id}`);
      const res = await fetch(`/api/modules/${module.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      setDuplicateJobId(data.jobId);
    } catch (err) {
      console.error("[ModuleEditButton] Duplicate start failed:", err);
      alert("Failed to start module duplication");
    }
  };

  const handleSendToN8n = async () => {
    if (!googleDriveUrl.trim()) {
      alert("Please enter a Google Drive Folder URL first");
      return;
    }
    setWebhookStatus("sending");
    try {
      const program = programs.find((p) => p.id === module.programId);
      await triggerN8nWebhook({
        programName: program?.name ?? "",
        moduleName: module.name,
        moduleId: module.id,
        googleDriveUrl: googleDriveUrl.trim(),
      });
      setWebhookStatus("sent");
      setGoogleDriveUrl("");
    } catch (err) {
      console.error("[ModuleEditButton] n8n webhook failed:", err);
      setWebhookStatus("error");
      alert("Failed to send to n8n");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this module? All lessons and assessments inside will be lost.")) return;
    setLoading(true);
    try {
      await deleteModule(module.id);
      router.refresh();
    } catch (err) {
      console.error("[ModuleEditButton] Delete failed:", err);
      alert("Failed to delete module");
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 text-slate-400 hover:text-primary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
      >
        <Edit2 className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Module</h3>
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
                        disabled={moving}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                      >
                        <Copy className="h-4 w-4 text-slate-400" />
                        Duplicate Module
                      </button>
                      <button
                        type="button"
                        onClick={() => { setActionsOpen(false); setShowMoveModal(true); }}
                        disabled={moving}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                      >
                        {moving ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        ) : (
                          <MoveRight className="h-4 w-4 text-slate-400" />
                        )}
                        {moving ? "Moving..." : "Move to Course"}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
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
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  disabled={loading}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
                />
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

            {/* n8n section */}
            <div className="px-6 pb-6 pt-0 space-y-3 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-4">Process with n8n</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Google Drive Folder URL <span className="text-red-500 ml-1">*</span>
                </label>
                <input
                  type="url"
                  value={googleDriveUrl}
                  onChange={(e) => { setGoogleDriveUrl(e.target.value); setWebhookStatus("idle"); }}
                  disabled={webhookStatus === "sending"}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleSendToN8n}
                disabled={webhookStatus === "sending" || !googleDriveUrl.trim()}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="h-3.5 w-3.5" />
                {webhookStatus === "sending" ? "Sending..." : webhookStatus === "sent" ? "✓ Sent" : webhookStatus === "error" ? "Retry Send" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMoveModal && (
        <MoveToCourseModal
          currentProgramId={module.programId}
          onSelect={handleMoveSelect}
          onClose={() => setShowMoveModal(false)}
        />
      )}

      {/* Redirect dialog after move */}
      {redirectDialogOpen && movedToProgramId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-sm border border-slate-200 dark:border-slate-800">
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Module moved</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Successfully moved to{" "}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {movedToProgramName ?? "another course"}
                </span>
                . Where would you like to go?
              </p>
            </div>
            <div className="px-6 py-4 flex flex-col gap-2">
              <button
                onClick={() => { setRedirectDialogOpen(false); router.refresh(); }}
                className="w-full px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors text-left"
              >
                Stay on this course
                <span className="block text-xs text-slate-400 mt-0.5">The moved module will no longer appear here.</span>
              </button>
              <button
                onClick={() => { setRedirectDialogOpen(false); router.push(`/courses/${movedToProgramId}`); }}
                className="w-full px-4 py-2.5 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors text-left"
              >
                Go to {movedToProgramName ?? "new course"}
                <span className="block text-xs mt-0.5 opacity-80">Navigate to where the module was moved.</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Job status toast for duplication */}
      {duplicateJobId && (
        <JobStatusToast
          jobId={duplicateJobId}
          label={`Duplicating module "${module.name}"`}
          onDismiss={() => setDuplicateJobId(null)}
        />
      )}
    </>
  );
}