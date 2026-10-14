"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LearningPathFormProps {
  cohortId: string;
  initialData?: {
    id: string;
    title: string;
    description: string | null;
  };
  onSuccess?: () => void;
}

export function LearningPathForm({ cohortId, initialData, onSuccess }: LearningPathFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: initialData?.title || "",
    description: initialData?.description || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const url = initialData
        ? `/api/admin/learning-paths/${initialData.id}`
        : `/api/admin/cohorts/${cohortId}/learning-paths`;
      
      const method = initialData ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        throw new Error("Failed to save Learning Path");
      }

      router.refresh();
      if (onSuccess) onSuccess();
      
      if (!initialData) {
        setFormData({ title: "", description: "" });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      <h3 className="text-lg font-medium">
        {initialData ? "Edit Learning Path" : "Create New Learning Path"}
      </h3>
      
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Title</label>
        <input
          type="text"
          required
          value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          className="w-full rounded-md border p-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="e.g. Week 1 Foundations"
          disabled={isLoading}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">Description</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          className="w-full rounded-md border p-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Optional description"
          rows={3}
          disabled={isLoading}
        />
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isLoading || !formData.title.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading ? "Saving..." : "Save Learning Path"}
        </button>
      </div>
    </form>
  );
}