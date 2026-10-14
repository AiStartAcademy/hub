// src/app/(dashboard)/assets/AssetCards.tsx

"use client";

import { useEffect, useState, lazy, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Download, FileText, Video, Presentation, PackageOpen, Pencil, Check, X, Loader2, Mail, User } from "lucide-react";
import LeadCaptureModal from "@/components/LeadCaptureModal";
import { updateMediaDescription } from "../media/actions";
import { readLeadEmailCookie } from "@/lib/lead-cookie";

// PDF.js requires browser DOM APIs, so we must disable SSR
const PdfPreview = dynamic(() => import("@/components/PdfPreview"), {
  ssr: false,
  loading: () => null,
});

// Helper to detect PDF files by extension
function isPdfFile(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

interface MediaFile {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number | null;
  description: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case "video":
      return <Video className="h-4 w-4 text-purple-500" />;
    case "presentation":
      return <Presentation className="h-4 w-4 text-amber-500" />;
    case "image":
      return <FileText className="h-4 w-4 text-blue-500" />;
    default:
      return <FileText className="h-4 w-4 text-slate-400" />;
  }
}

interface Props {
  files: MediaFile[];
  isAuthenticated: boolean;
  canEdit: boolean;
}

export default function AssetCards({ files, isAuthenticated, canEdit }: Props) {
  const searchParams = useSearchParams();
  const [descriptions, setDescriptions] = useState<Record<string, string | null>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);

  // Lead status from the cookie and the ID of the file to download
  const [knownEmail, setKnownEmail] = useState<string | null>(null);
  const [contactModalFileId, setContactModalFileId] = useState<string | null>(null);

  useEffect(() => {
    setKnownEmail(readLeadEmailCookie(document.cookie));
  }, []);

  // Initialize local descriptions from server data
  useEffect(() => {
    const map: Record<string, string | null> = {};
    for (const f of files) map[f.id] = f.description;
    setDescriptions(map);
  }, [files]);

  // Auto-download after login redirect
  useEffect(() => {
    const downloadId = searchParams.get("download");
    if (downloadId && isAuthenticated) {
      window.location.href = `/api/download/${downloadId}`;
      window.history.replaceState({}, "", "/assets");
    }
  }, [searchParams, isAuthenticated]);

    // Save UTM tracking to localStorage
  useEffect(() => {
    const utmSource = searchParams.get("utm_source");
    const savedSource = localStorage.getItem("utm_source");
    
    // Store only when the URL has UTMs, and never overwrite existing ones
    if (utmSource && !savedSource) {
      localStorage.setItem("utm_source", utmSource);
      
      const utmMedium = searchParams.get("utm_medium");
      if (utmMedium) localStorage.setItem("utm_medium", utmMedium);
      
      const utmCampaign = searchParams.get("utm_campaign");
      if (utmCampaign) localStorage.setItem("utm_campaign", utmCampaign);
      
      const utmContent = searchParams.get("utm_content");
      if (utmContent) localStorage.setItem("utm_content", utmContent);
      
      localStorage.setItem("utm_expires", String(Date.now() + 30 * 24 * 60 * 60 * 1000));
    }
  }, [searchParams]);

  const startEditing = (file: MediaFile) => {
    setEditingId(file.id);
    setEditValue(descriptions[file.id] || "");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditValue("");
  };

  const saveDescription = async (id: string) => {
    setSaving(true);
    try {
      await updateMediaDescription(id, editValue);
      setDescriptions((prev) => ({ ...prev, [id]: editValue || null }));
      setEditingId(null);
    } catch {
      alert("Failed to save description");
    } finally {
      setSaving(false);
    }
  };


  const handleQuickDownload = async (file: MediaFile) => {
    if (!knownEmail) return;
    try {
      await fetch("/api/download-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: knownEmail,
          mediaId: file.id,
          fileName: file.name,
          type: "ASSET_DOWNLOAD",
          isCookieTracking: true,
        }),
      });
      alert(`Download link successfully sent to ${knownEmail}`);
    } catch (e) {
      console.error(e);
    }
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <PackageOpen className="h-16 w-16 mb-4 opacity-10" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No assets available</p>
        <p className="text-xs mt-1">There are no materials available for download at this time</p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {files.map((file) => {
          const desc = descriptions[file.id] ?? file.description;
          const isEditing = editingId === file.id;
          const isPdf = isPdfFile(file.name);

          return (
            <div
              key={file.id}
              className="group bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 hover:border-primary/50 dark:hover:border-primary/50 transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 flex flex-col overflow-hidden"
            >
              {/* Preview Zone - dedicated area for visual content */}
              <div className="relative aspect-[4/3] bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center overflow-hidden border-b border-slate-100 dark:border-slate-800">
                {isPdf ? (
                  <PdfPreview
                    fileId={file.id}
                    fileName={file.name}
                    thumbnailUrl={file.thumbnailUrl}
                  />
                ) : file.type === "image" ? (
                  <img
                    src={file.url}
                    alt={file.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500">
                    <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm">
                      <TypeIcon type={file.type} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {file.type}
                    </span>
                  </div>
                )}

              </div>

              {/* Info Zone - metadata & actions (never covered by preview) */}
              <div className="flex flex-col flex-1 p-5">
                {/* Title */}
                <div className="flex items-start gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 group-hover:text-primary transition-colors leading-snug">
                    {file.name}
                  </h3>
                </div>

                {/* Description */}
                <div className="mt-3 flex-1 min-h-[2rem]">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="Add description..."
                        rows={3}
                        className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary/30 dark:bg-slate-800 dark:text-white resize-none leading-relaxed"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={cancelEditing}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => saveDescription(file.id)}
                          disabled={saving}
                          className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : desc ? (
                    <div className="relative group/desc">
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-4 leading-relaxed">
                        {desc}
                      </p>
                      {canEdit && (
                        <button
                          onClick={() => startEditing(file)}
                          className="absolute -top-1 -right-1 p-1 text-slate-300 hover:text-primary hover:bg-primary/10 rounded-lg transition-all opacity-0 group-hover/desc:opacity-100"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ) : canEdit ? (
                    <button
                      onClick={() => startEditing(file)}
                      className="text-[11px] text-slate-300 dark:text-slate-600 italic hover:text-primary transition-colors"
                    >
                      Add description...
                    </button>
                  ) : null}
                </div>

                {/* Footer */}
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {file.type}{formatSize(file.size) ? ` • ${formatSize(file.size)}` : ""}
                  </p>

                  {isAuthenticated ? (
                    <a
                      href={`/api/download/${file.id}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-primary/20"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  ) : knownEmail ? (
                    <button
                      onClick={() => handleQuickDownload(file)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-primary/20"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Send to Email
                    </button>
                  ) : (
                    <button
                      onClick={() => setContactModalFileId(file.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-primary/20"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Shared lead-capture modal */}
      <LeadCaptureModal 
         isOpen={!!contactModalFileId}
         onClose={() => setContactModalFileId(null)}
         type="ASSET_DOWNLOAD"
         metadata={{
           mediaId: contactModalFileId || undefined,
           fileName: files.find(f => f.id === contactModalFileId)?.name
         }}
         onSuccess={(email) => {
           setKnownEmail(email);
           // The modal shows its own success screen; nothing to do here
         }}
      />
    </>
  );
}
