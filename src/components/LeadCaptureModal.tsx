// src/components/LeadCaptureModal.tsx
"use client";

import { useState } from "react";
import { Mail, User, X, Check, Loader2, Download, Video } from "lucide-react";

interface LeadCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (email: string) => void;
  type: "ASSET_DOWNLOAD" | "LESSON_VIEW";
  metadata: {
    mediaId?: string;
    fileName?: string;
    lessonId?: string;
    lessonTitle?: string;
    courseName?: string;
    moduleName?: string;
  };
}

export default function LeadCaptureModal({
  isOpen,
  onClose,
  onSuccess,
  type,
  metadata,
}: LeadCaptureModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showSuccessScreen, setShowSuccessScreen] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !consent) return;

    setSubmitting(true);
    setError("");

    try {
      const utmSource = localStorage.getItem("utm_source");
      const utmMedium = localStorage.getItem("utm_medium");
      const utmCampaign = localStorage.getItem("utm_campaign");
      const utmContent = localStorage.getItem("utm_content");

      const res = await fetch("/api/download-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          type,
          consent,
          ...metadata,
          utmSource,
          utmMedium,
          utmCampaign,
          utmContent,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      if (type === "ASSET_DOWNLOAD") {
        setShowSuccessScreen(true);
        // Call onSuccess without closing immediately
        onSuccess(email); 
      } else {
        // Lessons close right away
        onSuccess(email);
        onClose();
      }
    } catch (err) {
      console.error("[LeadCapture] Network error", err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    // Lessons: the close button is disabled (blocking modal)
    if (type === "ASSET_DOWNLOAD") {
      onClose();
      // Reset state on close
      setTimeout(() => setShowSuccessScreen(false), 300);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm p-6 sm:p-8 shadow-2xl border border-slate-100 dark:border-slate-800 relative">
        
        {/* Close button (assets only) */}
        {type === "ASSET_DOWNLOAD" && (
          <button onClick={handleClose} className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
            <X className="h-5 w-5" />
          </button>
        )}

        {showSuccessScreen ? (
          <div className="flex flex-col items-center py-4 text-center animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/40 rounded-2xl flex items-center justify-center mb-5">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight mb-2">
              Link sent to email
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              We've sent the download link to <strong>{email}</strong>. Please check your inbox and spam folder.
            </p>
            <button
              onClick={handleClose}
              className="mt-8 w-full px-5 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-xl text-sm font-bold uppercase tracking-widest transition-all"
            >
              Close Window
            </button>
          </div>
        ) : (
          <div className="animate-in fade-in duration-300">
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                {type === "ASSET_DOWNLOAD" ? (
                  <Download className="h-6 w-6 text-primary" />
                ) : (
                  <Video className="h-6 w-6 text-primary" />
                )}
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-2">
                {type === "ASSET_DOWNLOAD" ? "Get Your Free File" : "Unlock Free Lesson"}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {type === "ASSET_DOWNLOAD" 
                  ? "Enter your details and we'll send the download link straight to your inbox." 
                  : "Enter your details to access this lesson, save your progress, and get related materials."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-3">
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input required autoFocus type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className="w-full pl-11 pr-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 dark:bg-slate-800 dark:text-white" />
                </div>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input required type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-11 pr-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 dark:bg-slate-800 dark:text-white" />
                </div>
              </div>

              <div className="flex items-start gap-3 pt-1">
                <input type="checkbox" id={`consent-${type}`} required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 flex-shrink-0 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/50" />
                <label htmlFor={`consent-${type}`} className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-snug cursor-pointer">
                  I agree to receive educational materials and update emails.
                </label>
              </div>

              {error && <p className="text-xs text-red-500 font-medium text-center bg-red-50 dark:bg-red-900/20 py-2 rounded-lg">{error}</p>}

              <button type="submit" disabled={submitting} className="w-full py-3 sm:py-3.5 bg-primary text-white rounded-xl text-sm font-bold uppercase tracking-widest shadow-lg shadow-primary/25 hover:bg-primary-dark transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {type === "ASSET_DOWNLOAD" ? "Send link" : "Get Access Now"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}