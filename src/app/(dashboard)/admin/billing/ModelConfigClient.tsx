"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { AI_FEATURES, aiModelSecretKey, type AiFeature } from "@/lib/ai/features";

type IntegrationItem = {
  key: string;
  kind: string;
  value: string | null;
};

type MutationResponse = {
  ok: true;
  key: string;
};

const REQUEST_TIMEOUT_MS = 10_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIntegrationItem(value: unknown): value is IntegrationItem {
  return (
    isObject(value) &&
    typeof value.key === "string" &&
    typeof value.kind === "string" &&
    (typeof value.value === "string" || value.value === null)
  );
}

function isMutationResponse(value: unknown, key: string): value is MutationResponse {
  return isObject(value) && value.ok === true && value.key === key;
}

function responseError(value: unknown, fallback: string): string {
  return isObject(value) && typeof value.error === "string" ? value.error : fallback;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export default function ModelConfigClient() {
  const [configured, setConfigured] = useState<Partial<Record<AiFeature, string>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<AiFeature, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AiFeature | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(signal: AbortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)): Promise<void> {
    try {
      const response = await fetch("/api/admin/integrations", {
        cache: "no-store",
        signal,
      });
      const data = await responseJson(response);
      setError(null);
      if (!response.ok) {
        throw new Error(responseError(data, `request failed with status ${response.status}`));
      }
      if (!isObject(data) || !Array.isArray(data.items) || !data.items.every(isIntegrationItem)) {
        throw new Error("response shape invalid");
      }

      const next: Partial<Record<AiFeature, string>> = {};
      for (const feature of AI_FEATURES) {
        const key = aiModelSecretKey(feature.key);
        const item = data.items.find((candidate) => candidate.key === key);
        if (item?.kind === "config" && item.value?.trim()) {
          next[feature.key] = item.value.trim();
        }
      }
      setConfigured(next);
      setDrafts(next);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(`Failed to load model configuration: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    void load(controller.signal);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  async function save(feature: AiFeature, valueOverride?: string): Promise<void> {
    const key = aiModelSecretKey(feature);
    const value = valueOverride?.trim() ?? drafts[feature]?.trim() ?? "";

    if (!value && !configured[feature]) {
      setError(null);
      return;
    }

    setSaving(feature);
    setError(null);
    try {
      const response = value
        ? await fetch("/api/admin/integrations", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, kind: "config", category: "llm", value }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          })
        : await fetch(`/api/admin/integrations?key=${encodeURIComponent(key)}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
      const data = await responseJson(response);
      if (!response.ok) {
        throw new Error(
          responseError(data, `${value ? "save" : "delete"} failed with status ${response.status}`)
        );
      }
      if (!isMutationResponse(data, key)) {
        throw new Error("response shape invalid");
      }

      await load();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(`Failed to update ${key}: ${message}`);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading model configuration…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
      <datalist id="ai-model-defaults">
        {[...new Set(AI_FEATURES.map((feature) => feature.defaultModel))].map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      {AI_FEATURES.map((feature) => {
        const isSaving = saving === feature.key;
        const isDefault = !configured[feature.key];
        return (
          <div
            key={feature.key}
            className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_minmax(16rem,1.5fr)_auto] md:items-end dark:border-slate-800"
          >
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">{feature.label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isDefault ? "Using feature default" : "Managed override"}
              </p>
            </div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              OpenRouter model
              <input
                list="ai-model-defaults"
                value={drafts[feature.key] ?? ""}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [feature.key]: event.target.value }))
                }
                placeholder={`Default: ${feature.defaultModel}`}
                disabled={isSaving}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 font-mono text-sm text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-white"
              />
            </label>
            <div className="flex gap-2">
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => {
                    setDrafts((current) => ({ ...current, [feature.key]: "" }));
                    void save(feature.key, "");
                  }}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="h-4 w-4" /> Default
                </button>
              )}
              <button
                type="button"
                onClick={() => void save(feature.key)}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
