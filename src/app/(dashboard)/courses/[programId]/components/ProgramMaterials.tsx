"use client";

import { FormEvent, useState } from "react";
import {
  ExternalLink,
  FileDown,
  FileText,
  Library,
  Link2,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { addProgramMaterial, deleteProgramMaterial } from "../../actions";
import { MATERIAL_TYPES } from "@/lib/programMaterials";

interface ProgramMaterial {
  id: string;
  title: string;
  type: string;
  url: string;
  order: number;
}

interface ProgramMaterialsProps {
  programId: string;
  materials: ProgramMaterial[];
  canManage: boolean;
}

type MaterialType = (typeof MATERIAL_TYPES)[number];

function MaterialIcon({ type }: { type: string }) {
  if (type === "link") return <Link2 className="h-5 w-5 text-primary" />;
  if (type === "pdf") return <FileDown className="h-5 w-5 text-primary" />;
  return <FileText className="h-5 w-5 text-primary" />;
}

export function ProgramMaterials({
  programId,
  materials,
  canManage,
}: ProgramMaterialsProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MaterialType>(MATERIAL_TYPES[0]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (materials.length === 0 && !canManage) return null;

  const sortedMaterials = [...materials].sort((a, b) => a.order - b.order);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !url.trim()) {
      alert("Title and URL are required.");
      return;
    }

    setLoading(true);
    try {
      await addProgramMaterial(programId, { title, type, url });
      setTitle("");
      setType(MATERIAL_TYPES[0]);
      setUrl("");
      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Failed to add material. Please check the details and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (material: ProgramMaterial) => {
    if (!confirm(`Delete \"${material.title}\"?`)) return;

    setLoading(true);
    try {
      await deleteProgramMaterial(material.id);
      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Failed to delete material. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <Library className="h-5 w-5 text-primary" />
        Materials
      </h2>

      {sortedMaterials.length > 0 && (
        <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
          {sortedMaterials.map((material) => (
            <div
              key={material.id}
              className="flex items-center gap-3 py-4"
            >
              <MaterialIcon type={material.type} />
              <a
                href={material.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 group"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium text-slate-900 dark:text-white group-hover:text-primary transition-colors truncate">
                    {material.title}
                  </span>
                  <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {material.type}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 group-hover:text-primary transition-colors truncate">
                  {material.url}
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                </span>
              </a>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleDelete(material)}
                  disabled={loading}
                  aria-label={`Delete ${material.title}`}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <form
          onSubmit={handleSubmit}
          className="grid gap-3 border-t border-slate-200 dark:border-slate-800 pt-6 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]"
        >
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={loading}
            required
            placeholder="Material title"
            aria-label="Material title"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
          />
          <select
            value={type}
            onChange={(event) => setType(event.target.value as MaterialType)}
            disabled={loading}
            aria-label="Material type"
            className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
          >
            {MATERIAL_TYPES.map((materialType) => (
              <option key={materialType} value={materialType}>
                {materialType.toUpperCase()}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={loading}
            required
            placeholder="https://… or /materials/…"
            aria-label="Material URL"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary dark:bg-slate-800 dark:text-white disabled:opacity-50 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary-dark rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {loading ? "Saving…" : "Add"}
          </button>
        </form>
      )}
    </section>
  );
}
