"use client";

import { useState, useRef } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";

interface CoverUploaderProps {
  currentCover?: string;
  onCoverChange: (url: string | null) => void;
  disabled?: boolean;
}

export function CoverUploader({ currentCover, onCoverChange, disabled }: CoverUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentCover || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to server
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      onCoverChange(data.url);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image");
      setPreview(currentCover || null);
    } finally {
      setUploading(false);
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
        Course Cover
      </label>

      {preview ? (
        <div className="relative group">
          <img
            src={preview}
            alt="Course cover preview"
            className="w-full h-40 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
          />
          <button
            type="button"
            onClick={handleRemove}
            disabled={uploading || disabled}
            className="absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
        >
          <ImageIcon className="h-8 w-8 mx-auto text-slate-400 mb-2" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {uploading ? "Uploading..." : "Click to upload cover image"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            PNG, JPG up to 5MB
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={uploading || disabled}
        className="hidden"
      />
    </div>
  );
}
