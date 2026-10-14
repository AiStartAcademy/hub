// src/app/(dashboard)/courses/components/CourseEditButton.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Edit2, Trash2, Copy, MoreVertical, Globe, Lock, Users, UserCheck, X, Search, Loader2, ShieldCheck, BadgeCheck } from "lucide-react";
import { updateProgram, deleteProgram } from "../actions";
import { useRouter } from "next/navigation";
import { CoverUploader } from "./CoverUploader";
import { JobStatusToast } from "@/components/JobStatusToast";

type AccessMode = "cohort" | "direct" | "auth" | "public" | "member";

interface DirectAccessUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface ProgramData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  locked: boolean;
  cover: string | null;
  accessMode?: AccessMode;
}

export function CourseEditButton({ program }: { program: ProgramData }) {
  const [open, setOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description || "");
  const [status, setStatus] = useState(program.status);
  const [locked, setLocked] = useState(program.locked ?? false);
  const [cover, setCover] = useState(program.cover || null);
  const [loading, setLoading] = useState(false);
  const [duplicateJobId, setDuplicateJobId] = useState<string | null>(null);

  // Access control state
  const [accessMode, setAccessMode] = useState<AccessMode>(program.accessMode ?? "cohort");
  const [memberMinTier, setMemberMinTier] = useState<string | null>(null);
  const [directUsers, setDirectUsers] = useState<DirectAccessUser[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<DirectAccessUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

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

  // Load access config when modal opens
  useEffect(() => {
    if (!open) return;
    setAccessLoading(true);
    fetch(`/api/admin/programs/${program.id}/access`)
      .then((r) => r.json())
      .then((data) => {
        if (data.accessMode) setAccessMode(data.accessMode as AccessMode);
        setMemberMinTier(data.memberMinTier ?? null);
        setDirectUsers(data.accessList?.map((a: { user: DirectAccessUser }) => a.user) ?? []);
      })
      .catch((err) => console.error("[CourseEditButton] Failed to load access config:", err))
      .finally(() => setAccessLoading(false));
  }, [open, program.id]);

  // Debounced user search
  useEffect(() => {
    if (!userSearch.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(userSearch)}&role=STUDENT`);
        const data = await res.json();
        setSearchResults(data ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearch]);

  const handleAccessModeChange = async (mode: AccessMode) => {
    setAccessMode(mode);
    try {
      await fetch(`/api/admin/programs/${program.id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessMode: mode }),
      });
      console.log(`[CourseEditButton] accessMode updated to ${mode}`);
    } catch (err) {
      console.error("[CourseEditButton] Failed to update accessMode:", err);
    }
  };

  const handleMemberMinTierChange = async (tier: string | null) => {
    setMemberMinTier(tier);
    try {
      await fetch(`/api/admin/programs/${program.id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberMinTier: tier }),
      });
      console.log(`[CourseEditButton] memberMinTier updated to ${tier ?? "any"}`);
    } catch (err) {
      console.error("[CourseEditButton] Failed to update memberMinTier:", err);
    }
  };

  const handleAddDirectUser = async (user: DirectAccessUser) => {
    if (directUsers.some((u) => u.id === user.id)) return;
    try {
      const res = await fetch(`/api/admin/programs/${program.id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (res.ok) {
        setDirectUsers((prev) => [...prev, user]);
        setUserSearch("");
        setSearchResults([]);
        console.log(`[CourseEditButton] Direct access granted to userId=${user.id}`);
      }
    } catch (err) {
      console.error("[CourseEditButton] Failed to add direct access:", err);
    }
  };

  const handleRemoveDirectUser = async (userId: string) => {
    try {
      await fetch(`/api/admin/programs/${program.id}/access?userId=${userId}`, {
        method: "DELETE",
      });
      setDirectUsers((prev) => prev.filter((u) => u.id !== userId));
      console.log(`[CourseEditButton] Direct access revoked for userId=${userId}`);
    } catch (err) {
      console.error("[CourseEditButton] Failed to remove direct access:", err);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateProgram(program.id, { name, description, status, locked, cover });
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error("[CourseEditButton] Update failed:", err);
      alert("Failed to update course");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this course? All modules, lessons, and assessments will be lost.")) return;
    setLoading(true);
    try {
      await deleteProgram(program.id);
      router.push("/courses");
    } catch (err) {
      console.error("[CourseEditButton] Delete failed:", err);
      alert("Failed to delete course");
      setLoading(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      console.log(`[CourseEditButton] Starting course duplication for ${program.id}`);
      const res = await fetch(`/api/programs/${program.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      setDuplicateJobId(data.jobId);
    } catch (err) {
      console.error("[CourseEditButton] Duplicate start failed:", err);
      alert("Failed to start course duplication");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 text-slate-400 hover:text-primary transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
      >
        <Edit2 className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Edit Course</h3>
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
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                      >
                        <Copy className="h-4 w-4 text-slate-400" />
                        Duplicate Course
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                  title="Delete Course"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <form onSubmit={handleUpdate} className="p-6 space-y-4">
              <CoverUploader
                currentCover={cover as any}
                courseName={name}
                onCoverChange={setCover}
                disabled={loading}
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  disabled={loading}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:border-slate-700 dark:text-white focus:outline-none disabled:opacity-50"
                >
                  <option value="raw">RAW</option>
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={locked}
                    onChange={(e) => setLocked(e.target.checked)}
                    disabled={loading}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-primary" />
                </label>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Locked (only enrolled students can view)
                </span>
              </div>

             {/* ─── Access Control ─── */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Access Control
                </h4>

                {/* Mode selector */}
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: "cohort", label: "Cohort only", icon: Users, desc: "Via cohort enrollment" },
                      { value: "direct", label: "Direct", icon: UserCheck, desc: "Specific users" },
                      { value: "auth", label: "Registered", icon: Lock, desc: "Any logged-in user" },
                      { value: "member", label: "Members only", icon: BadgeCheck, desc: "Any active member" },
                      { value: "public", label: "Public", icon: Globe, desc: "Everyone" },
                    ] as const
                  ).map(({ value, label, icon: Icon, desc }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleAccessModeChange(value)}
                      className={`flex items-start gap-2 p-3 rounded-xl border-2 text-left transition-all ${
                        accessMode === value
                          ? "border-primary bg-primary/5 dark:bg-primary/10"
                          : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                      }`}
                    >
                      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${accessMode === value ? "text-primary" : "text-slate-400"}`} />
                      <div>
                        <p className={`text-xs font-bold ${accessMode === value ? "text-primary" : "text-slate-700 dark:text-slate-300"}`}>
                          {label}
                        </p>
                        <p className="text-[10px] text-slate-500 leading-tight">{desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              
                {/* Minimum tier — only for member mode */}
                {accessMode === "member" && (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">Minimum membership tier:</p>
                    <div className="flex gap-2">
                      {(
                        [
                          { value: null, label: "Any member" },
                          { value: "MENTOR_NETWORK", label: "Recordings ($50)" },
                          { value: "ACCELERATOR", label: "Accelerator ($500)" },
                        ] as const
                      ).map(({ value, label }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => handleMemberMinTierChange(value)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                            memberMinTier === value
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Direct access user list — only for direct mode */}
                {accessMode === "direct" && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">Users with direct access:</p>

                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search student by name or email..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      {searchLoading && (
                        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-slate-400" />
                      )}
                    </div>

                    {/* Search results */}
                    {searchResults.length > 0 && (
                      <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                        {searchResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => handleAddDirectUser(u)}
                            disabled={directUsers.some((d) => d.id === u.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                              {u.name?.[0] ?? u.email[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{u.name ?? "Unnamed"}</p>
                              <p className="text-[10px] text-slate-500 truncate">{u.email}</p>
                            </div>
                            {directUsers.some((d) => d.id === u.id) && (
                              <span className="ml-auto text-[10px] text-emerald-600 font-semibold">Added</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Current direct users */}
                    {accessLoading ? (
                      <div className="flex items-center justify-center py-3">
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      </div>
                    ) : directUsers.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No users added yet</p>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {directUsers.map((u) => (
                          <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg">
                            <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                              {u.name?.[0] ?? u.email[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{u.name ?? "Unnamed"}</p>
                              <p className="text-[10px] text-slate-500 truncate">{u.email}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveDirectUser(u.id)}
                              className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded transition-colors flex-shrink-0"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>            
              
              <div className="flex justify-end gap-3 pt-4">
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

      {/* Job status toast */}
      {duplicateJobId && (
        <JobStatusToast
          jobId={duplicateJobId}
          label={`Duplicating course "${program.name}"`}
          onDismiss={() => setDuplicateJobId(null)}
        />
      )}
    </>
  );
}
