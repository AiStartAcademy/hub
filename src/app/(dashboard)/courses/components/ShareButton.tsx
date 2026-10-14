"use client";

import { useState } from "react";
import { Share2, Copy, Check } from "lucide-react";

interface ShareButtonProps {
  programId: string;
  programName: string;
}

export function ShareButton({ programId, programName }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const handleShare = async () => {
    const courseUrl = `${window.location.origin}/courses/${programId}`;
    const shareText = `Check out "${programName}" course`;

    // Try Web Share API first (works on mobile and some browsers)
    if (navigator.share) {
      try {
        setIsSharing(true);
        await navigator.share({
          title: programName,
          text: shareText,
          url: courseUrl,
        });
        return;
      } catch (error) {
        // User cancelled or share failed - fallback to copy
        if ((error as Error).name !== "AbortError") {
          console.error("Share failed:", error);
        }
      } finally {
        setIsSharing(false);
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(courseUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={isSharing}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      title={copied ? "Link copied!" : "Share course"}
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" />
          <span className="text-sm">Copied</span>
        </>
      ) : (
        <>
          <Share2 className="h-4 w-4" />
          <span className="text-sm">Share</span>
        </>
      )}
    </button>
  );
}
