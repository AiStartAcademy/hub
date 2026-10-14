"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { createPortal } from "react-dom";

interface PdfModalProps {
  url: string;
  fileName: string;
  onClose: () => void;
}

/** Detects if the browser can render PDF natively (in iframe) */
function usePdfSupported(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const hasPdfViewer =
      typeof navigator.pdfViewerEnabled === "boolean"
        ? navigator.pdfViewerEnabled
        : true;
    // On mobile, even if pdfViewerEnabled is true, iframe PDF UX is poor
    const enabled = hasPdfViewer && !isMobile;
    console.log(
      `[PdfModal] pdfViewerEnabled=${navigator.pdfViewerEnabled}, isMobile=${isMobile}, enabled=${enabled}`
    );
    setSupported(enabled);
  }, []);
  return supported;
}

export default function PdfModal({ url, fileName, onClose }: PdfModalProps) {
  const pdfSupported = usePdfSupported();

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
            {fileName}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors flex-shrink-0"
            aria-label="Close modal"
          >
            <X className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden rounded-b-2xl">
          {!pdfSupported ? (
            // iOS/mobile browsers without native PDF support — open in new tab
            <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <svg className="h-8 w-8 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2.5L18.5 11H13V4.5z"/>
                </svg>
              </div>
              <div>
                <p className="text-slate-700 dark:text-slate-300 font-medium mb-1">
                  {fileName}
                </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    PDF preview is not supported in this browser.
                    Open in a new tab to view.
                  </p>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
                onClick={() => console.log(`[PdfModal] Opening PDF in new tab (iOS): ${fileName}`)}
              >
                <ExternalLink className="h-4 w-4" />
                Open PDF
              </a>
            </div>
          ) : (
            <iframe
              src={`${url}#toolbar=1&navpanes=0`}
              className="w-full h-full border-0"
              title={fileName}
              onLoad={() => console.log(`[PdfModal] PDF loaded: ${fileName}`)}
              onError={() =>
                console.error(`[PdfModal] Failed to load PDF: ${fileName}`)
              }
            />
          )}
        </div>
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(modal, document.body);
}