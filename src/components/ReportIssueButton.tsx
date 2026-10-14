"use client";

import { useState } from "react";
import { AlertTriangle, X, Send, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";

const ISSUE_TYPES = ["Bug", "UI/UX", "Performance", "Content", "Feature Request", "Other"];

export default function ReportIssueButton() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState("Bug");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  if (!session) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || description.trim().length < 5) return;

    setStatus("loading");
    try {
      console.log("[ReportIssue] Submitting report...");
      const res = await fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          description: description.trim(),
          currentUrl: typeof window !== "undefined" ? window.location.href : "",
        }),
      });

      if (!res.ok) throw new Error("Server error");
      console.log("[ReportIssue] Report sent successfully");
      setStatus("success");
      setTimeout(() => {
        setIsOpen(false);
        setStatus("idle");
        setDescription("");
        setType("Bug");
      }, 1500);
    } catch (err) {
      console.error("[ReportIssue] Submit failed:", err);
      setStatus("error");
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="group flex w-full items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200
          bg-red-50 text-red-600 hover:bg-red-100
          dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20
          border border-red-100 dark:border-red-500/20 mt-2"
      >
        <AlertTriangle className="mr-3 h-5 w-5" />
        Report Issue
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-xl bg-white dark:bg-[#1B1F3B] border border-[#D9DEE8] dark:border-[#2e3560] shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#11131D] dark:text-[#F8F9FA]">
                Report an Issue
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-[#EEF1F6] dark:hover:bg-white/5 text-[#6C757D]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {status === "success" ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400">
                  <Send className="h-6 w-6" />
                </div>
                <p className="font-semibold text-[#11131D] dark:text-[#F8F9FA]">Thank you!</p>
                <p className="text-sm text-[#6C757D] dark:text-[#9AA3B2]">
                  Your report has been sent to the team.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#11131D] dark:text-[#F8F9FA]">
                    Issue Type
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#23284A] px-3 py-2 text-sm text-[#11131D] dark:text-[#F8F9FA] focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {ISSUE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#11131D] dark:text-[#F8F9FA]">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    placeholder="Describe what went wrong..."
                    required
                    minLength={5}
                    className="w-full rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#23284A] px-3 py-2 text-sm text-[#11131D] dark:text-[#F8F9FA] placeholder:text-[#9AA3B2] focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                  />
                  <p className="mt-1 text-xs text-[#9AA3B2]">Minimum 5 characters</p>
                </div>

                {status === "error" && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Failed to send report. Please try again.
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-[#6C757D] hover:bg-[#EEF1F6] dark:text-[#9AA3B2] dark:hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={status === "loading" || description.trim().length < 5}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-red-600/25"
                  >
                    {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
                    Send Report
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}