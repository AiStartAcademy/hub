// src/app/(dashboard)/courses/components/CoverUploader.tsx
"use client";

import { useState, useRef } from "react";
import { X, Image as ImageIcon, Sparkles, Loader, Upload } from "lucide-react";

interface CoverUploaderProps {
  currentCover?: string;
  onCoverChange: (url: string | null) => void;
  onUploadingChange?: (isUploading: boolean) => void;
  disabled?: boolean;
  courseName?: string; 
  entityName?: string;
  entityType?: "course" | "cohort";
}

export function CoverUploader({ 
  currentCover, 
  onCoverChange,
  onUploadingChange,
  disabled, 
  courseName, 
  entityName, 
  entityType = "course" 
}: CoverUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentCover || null);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  const nameToUse = entityName || courseName;

  const handleSetUploading = (state: boolean) => {
    setUploading(state);
    onUploadingChange?.(state);
  };

  const handleSetGenerating = (state: boolean) => {
    setGenerating(state);
    onUploadingChange?.(state);
  };

  const getSafeUploadPath = (name: string) => {
    const safeName = name
      .trim()
      .toLowerCase() // Lowercase
      .replace(/\s+/g, "-") // Spaces to hyphens
      .replace(/[^a-z0-9\-_]/g, ""); // Keep only safe characters
      
    const prefix = entityType === "cohort" ? "cohorts" : "courses";
    return `${prefix}/${safeName}/covers`;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => setPreview(event.target?.result as string);
    reader.readAsDataURL(file);

    handleSetUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      if (nameToUse) {
        formData.append("uploadPath", getSafeUploadPath(nameToUse));
      }

      const response = await fetch("/api/upload", { method: "POST", body: formData });
      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setPreview(data.url); // Sync the preview with the final URL
      onCoverChange(data.url);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image");
      setPreview(currentCover || null);
    } finally {
      handleSetUploading(false);
    }
  };

  const handleRefImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingRef(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      if (nameToUse) {
        formData.append("uploadPath", getSafeUploadPath(nameToUse));
      }

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      setReferenceImageUrl(data.url);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload reference image");
    } finally {
      setUploadingRef(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!isAdvancedMode) {
      if (!nameToUse || !nameToUse.trim()) {
        alert(`Please enter a ${entityType} name first`);
        return;
      }
      setPrompt(`Create a professional ${entityType} cover image for: "${nameToUse}". The image should be visually appealing, educational, and suitable for an online learning platform. Use vibrant colors and modern design.`);
      setIsAdvancedMode(true);
      return;
    }

    if (!prompt.trim()) {
      alert("Please enter a prompt first");
      return;
    }

    handleSetGenerating(true);
    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt, image_url: referenceImageUrl }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate image");
      }

      const data = await response.json(); 
      setPreview(data.url);
      onCoverChange(data.url);
      setIsAdvancedMode(false);
    } catch (error) {
      console.error("Generation error:", error);
      alert("Failed to generate cover image. Please try again.");
    } finally {
      handleSetGenerating(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onCoverChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {entityType === "cohort" ? "Cohort Cover" : "Course Cover"}
      </label>

      {preview ? (
        <div className="relative group">
          <img
            src={preview}
            alt="Cover preview"
            className="w-full h-40 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
          />
          <button
            type="button"
            onClick={handleRemove}
            disabled={uploading || disabled || generating}
            className="absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : isAdvancedMode ? (
        <div className="border border-purple-200 dark:border-purple-900 bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Advanced AI Generation
            </h3>
            <button
              type="button"
              onClick={() => setIsAdvancedMode(false)}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
          
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full text-sm border-slate-300 dark:border-slate-700 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-white dark:bg-slate-800 p-2"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Reference Image (optional)</label>
            {referenceImageUrl ? (
               <div className="relative inline-block w-full">
                 <img src={referenceImageUrl} alt="Reference" className="h-24 w-auto object-cover rounded shadow" />
                 <button type="button" onClick={() => setReferenceImageUrl(null)} className="absolute top-1 left-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"><X className="h-3 w-3" /></button>
               </div>
            ) : (
               <button
                 type="button"
                 onClick={() => refFileInputRef.current?.click()}
                 className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                 disabled={uploadingRef}
               >
                 {uploadingRef ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                 {uploadingRef ? "Uploading..." : "Upload Reference Image"}
               </button>
            )}
            
            <input
              ref={refFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleRefImageUpload}
              className="hidden"
            />
          </div>

          <button
            type="button"
            onClick={handleGenerateImage}
            disabled={generating || !prompt.trim()}
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Now
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center space-y-4">
          <div
            onClick={() => !disabled && !uploading && !generating && fileInputRef.current?.click()}
            className="cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors p-4 rounded-lg border border-dashed border-slate-200 dark:border-slate-700"
          >
            <ImageIcon className="h-8 w-8 mx-auto text-slate-400 mb-2" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {uploading ? "Uploading..." : "Click to upload cover image"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              PNG, JPG up to 5MB
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-slate-400">or</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          </div>

          <button
            type="button"
            onClick={handleGenerateImage}
            disabled={disabled || uploading || generating || !nameToUse?.trim()}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate with AI
              </>
            )}
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={uploading || disabled || generating}
        className="hidden"
      />
    </div>
  );
}