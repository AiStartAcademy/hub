"use client";

import { useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Plus,
  Loader2,
  Save,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  CATEGORIES,
  KINDS,
  KNOWN_INTEGRATION_KEYS,
  KNOWN_INTEGRATION_KEYS_BY_KEY,
  type IntegrationCategory,
  type IntegrationKind,
} from "./knownKeys";

type Item = {
  key: string;
  category: IntegrationCategory;
  kind: IntegrationKind;
  description: string | null;
  value: string | null; // config only
  last4: string | null; // secret only
  isSet: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

type EditingForm = {
  key: string;
  category: IntegrationCategory;
  kind: IntegrationKind;
  value: string;
  description: string;
};

type IntegrationsResponse = {
  items: Item[];
  cryptoReady: boolean;
};

type ErrorResponse = {
  error?: string;
};

const emptyForm: EditingForm = {
  key: "",
  category: "other",
  kind: "secret",
  value: "",
  description: "",
};

function applyKnownKeyMetadata(form: EditingForm, keyInput: string): EditingForm {
  const key = keyInput.toUpperCase();
  const knownKey = KNOWN_INTEGRATION_KEYS_BY_KEY.get(key);
  if (!knownKey) {
    return { ...form, key };
  }
  return {
    ...form,
    key: knownKey.key,
    category: knownKey.category,
    kind: knownKey.kind,
  };
}

function valuePlaceholder(kind: IntegrationKind): string {
  if (kind === "secret") return "paste the token…";
  return "https://…";
}

export default function IntegrationsClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [cryptoReady, setCryptoReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditingForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/integrations", { cache: "no-store" });
      const data: IntegrationsResponse & ErrorResponse = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `request failed with status ${res.status}`);
      }
      if (!Array.isArray(data.items) || typeof data.cryptoReady !== "boolean") {
        throw new Error("response shape invalid");
      }
      setItems(data.items);
      setCryptoReady(data.cryptoReady);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(`Failed to load integrations: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const g: Partial<Record<IntegrationCategory, Item[]>> = {};
    for (const it of items) (g[it.category] ??= []).push(it);
    return g;
  }, [items]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const data: ErrorResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `save failed with status ${res.status}`);
      }
      setEditing(null);
      await load();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(`Failed to save ${editing.key || "integration"}: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(key: string) {
    if (!confirm(`Remove managed value for ${key}? It will fall back to the env value if one exists.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/integrations?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      const data: ErrorResponse = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `delete failed with status ${res.status}`);
      }
      await load();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : String(removeError);
      setError(`Failed to remove ${key}: ${message}`);
    }
  }

  function editExisting(it: Item) {
    // Secrets are write-only: never prefill the value. Config values are safe to prefill.
    setEditing({
      key: it.key,
      category: it.category,
      kind: it.kind,
      value: it.kind === "config" ? (it.value ?? "") : "",
      description: it.description ?? "",
    });
  }

  const editingKnownKey = editing ? KNOWN_INTEGRATION_KEYS_BY_KEY.get(editing.key) : undefined;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <KeyRound className="h-6 w-6 text-rose-500" />
          <div>
            <h1 className="text-xl font-bold">Integrations</h1>
            <p className="text-sm text-[#6C757D] dark:text-[#9AA3B2]">
              API keys, tokens & service config. Secrets are encrypted at rest and never shown
              again after saving.
            </p>
          </div>
        </div>
        <button
          onClick={() => { setError(null); setEditing({ ...emptyForm }); }}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      {!cryptoReady && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span><strong>SETTINGS_ENC_KEY is not configured.</strong> Secret values can’t be
          saved or read until devops sets it in this environment. Config values still work.</span>
        </div>
      )}

      {error && !editing && <p className="mb-4 text-sm text-rose-500">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-[#6C757D]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#6C757D]">No managed integrations yet. Add one to override an env value from here.</p>
      ) : (
        CATEGORIES.filter((c) => grouped[c]?.length).map((cat) => (
          <div key={cat} className="mb-6">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#9AA3B2]">{cat}</p>
            <div className="divide-y divide-[#D9DEE8] dark:divide-[#2e3560] rounded-lg border border-[#D9DEE8] dark:border-[#2e3560]">
              {(grouped[cat] ?? []).map((it) => (
                <div key={it.key} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-semibold">{it.key}</code>
                      <span className="rounded bg-[#EEF1F6] dark:bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-[#6C757D]">{it.kind}</span>
                    </div>
                    <div className="text-xs text-[#6C757D] dark:text-[#9AA3B2] truncate">
                      {it.kind === "config"
                        ? (it.value || <em>empty</em>)
                        : it.isSet ? `••••${it.last4}` : <em>not set</em>}
                    </div>
                    {(KNOWN_INTEGRATION_KEYS_BY_KEY.get(it.key)?.description || it.description) && (
                      <div className="text-xs text-[#6C757D] dark:text-[#9AA3B2]">
                        {KNOWN_INTEGRATION_KEYS_BY_KEY.get(it.key)?.description ?? it.description}
                        {KNOWN_INTEGRATION_KEYS_BY_KEY.get(it.key)?.description &&
                        it.description &&
                        it.description !== KNOWN_INTEGRATION_KEYS_BY_KEY.get(it.key)?.description
                          ? ` — ${it.description}`
                          : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => editExisting(it)} className="rounded p-2 hover:bg-[#EEF1F6] dark:hover:bg-white/5" title="Edit"><Save className="h-4 w-4" /></button>
                    <button onClick={() => remove(it.key)} className="rounded p-2 text-rose-500 hover:bg-rose-500/10" title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#151935] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">{items.some((i) => i.key === editing.key) ? "Edit" : "Add"} integration</h2>
              <button onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
            </div>

            <label className="block text-xs font-medium mb-1">Key (UPPER_SNAKE_CASE)</label>
            <input
              value={editing.key}
              onChange={(e) => setEditing(applyKnownKeyMetadata(editing, e.target.value))}
              placeholder="HUB_MCP_TOKEN"
              list="known-integration-keys"
              className="mb-1 w-full rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-transparent px-3 py-2 text-sm font-mono"
            />
            <datalist id="known-integration-keys">
              {KNOWN_INTEGRATION_KEYS.map((entry) => (
                <option
                  key={entry.key}
                  value={entry.key}
                  label={`${entry.label} (${entry.category} / ${entry.kind})`}
                />
              ))}
            </datalist>
            <p className="mb-3 text-[11px] text-[#6C757D] dark:text-[#9AA3B2]">
              {editingKnownKey
                ? `${editingKnownKey.label} — ${editingKnownKey.description}`
                : "Pick a known key from the suggestions or enter a custom key."}
            </p>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Kind</label>
                <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as IntegrationKind })} className="w-full rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-transparent px-3 py-2 text-sm">
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Category</label>
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as IntegrationCategory })} className="w-full rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-transparent px-3 py-2 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <label className="block text-xs font-medium mb-1">
              {editing.kind === "secret" ? "Value (write-only — stored encrypted)" : "Value"}
            </label>
            <input
              type={editing.kind === "secret" ? "password" : "text"}
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              placeholder={editingKnownKey?.example ?? valuePlaceholder(editing.kind)}
              className="mb-1 w-full rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-transparent px-3 py-2 text-sm font-mono"
            />
            {editing.kind === "secret" && (
              <p className="mb-3 flex items-center gap-1 text-[11px] text-[#6C757D]"><ShieldCheck className="h-3 w-3" /> Encrypted on save; not retrievable afterward — only overwritten.</p>
            )}

            <label className="block text-xs font-medium mb-1 mt-2">Description (optional)</label>
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="mb-4 w-full rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] bg-transparent px-3 py-2 text-sm" />

            {error && <p className="mb-3 text-sm text-rose-500">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
