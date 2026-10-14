"use client";

import React, { useState } from 'react';
import { FileText, Maximize2, ExternalLink, Loader2, AlertCircle } from 'lucide-react';

interface PresentationPlayerProps {
  url: string;
  title?: string;
}

export default function PresentationPlayer({ url, title }: PresentationPlayerProps) {
  const [loading, setLoading] = useState(true);
  const isPdf = url.toLowerCase().endsWith('.pdf');
  
  // Google Docs Viewer works for both PDF and PPTX/DOCX
  // Note: It requires the file to be publicly accessible
  const viewerUrl = isPdf 
    ? `${url}#toolbar=0` 
    : `https://docs.google.com/viewer?url=${encodeURIComponent(window.location.origin + url)}&embedded=true`;

  return (
    <div className="w-full aspect-[16/10] bg-slate-900 rounded-3xl overflow-hidden shadow-2xl relative group border border-slate-200 dark:border-slate-800">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 z-10 transition-opacity duration-500">
           <div className="relative">
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                 <FileText className="h-6 w-6 text-primary" />
              </div>
           </div>
           <p className="mt-4 text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse">
              Preparing Presentation...
           </p>
        </div>
      )}
      
      <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <a 
          href={url} 
          target="_blank" 
          rel="noreferrer"
          className="p-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-xl text-slate-600 dark:text-slate-300 hover:text-primary dark:hover:text-primary transition-all shadow-lg border border-slate-100 dark:border-slate-700"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <iframe
        src={viewerUrl}
        className="w-full h-full border-none"
        onLoad={() => setLoading(false)}
        title={title || "Presentation Viewer"}
      />

      {!isPdf && loading && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full flex items-center gap-2 z-20">
          <AlertCircle className="h-3 w-3 text-amber-500" />
          <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
            Note: Office files require a public URL to preview
          </p>
        </div>
      )}
    </div>
  );
}
