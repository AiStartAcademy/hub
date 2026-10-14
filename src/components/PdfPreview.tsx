"use client";

import { useState } from "react";
import PdfModal from "./PdfModal";

interface PdfPreviewProps {
  fileId: string;
  fileName: string;
  thumbnailUrl?: string | null;
}

export function isPdfFile(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

export default function PdfPreview({ fileId, fileName, thumbnailUrl }: PdfPreviewProps) {
  const pdfUrl = `/api/pdf-preview/${fileId}#toolbar=0&navpanes=0`;

  const [isHovered, setIsHovered] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasThumbnail = !!thumbnailUrl && !imgError;

  return (
    <>
      <div
        className="relative w-full h-full flex items-center justify-center overflow-hidden cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => setIsModalOpen(true)}
      >
        {hasThumbnail ? (
          // Fast path: show pre-generated PNG thumbnail from GCS
          <div className={`w-full h-full transition-transform duration-300 ${isHovered ? "scale-110" : "scale-100"}`}>
            <img
              src={thumbnailUrl!}
              alt={`Preview of ${fileName}`}
              className="w-full h-full object-cover rounded"
              onError={() => {
                console.warn(`[PdfPreview] Thumbnail failed to load for ${fileName}`);
                setImgError(true);
              }}
            />
          </div>
        ) : (
          // Fallback: no thumbnail available
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm">
              <svg className="h-7 w-7 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2.5L18.5 11H13V4.5z"/>
              </svg>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              PDF
            </span>
          </div>
        )}

        {/* Click hint on hover */}
        {isHovered && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center pointer-events-none">
            <span className="text-white text-xs font-bold uppercase tracking-wider bg-slate-900/80 px-3 py-1.5 rounded-full">
              Click to view
            </span>
          </div>
        )}
      </div>

      {isModalOpen && (
        <PdfModal
          url={pdfUrl}
          fileName={fileName}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}