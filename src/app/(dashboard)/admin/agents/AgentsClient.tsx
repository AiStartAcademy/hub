"use client";
// src/app/(dashboard)/admin/agents/AgentsClient.tsx
// Agent control plane: health, latest run, and controls (run-now / enable /
// disable / delete). Syncs the registry from the agents service. Talks to
// /api/admin/agents and /api/agents/[slug]/run.
import { useCallback, useEffect, useState } from "react";
import { Bot, Play, RefreshCw, Trash2, Pause, Power } from "lucide-react";

interface LastRun {
  id: string;
  status: string;
  itemsProduced: number;
  costUsd: number | null;
  error: string | null;
  logTail: string | null;
  finishedAt: string | null;
  createdAt: string;
}
interface Agent {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string; // ENABLED | PAUSED | DISABLED
  triggerType: string;
  schedule: string | null;
  health: string; // healthy | failing | stuck | running | idle | disabled
  lastRun: LastRun | null;
}

const HEALTH: Record<string, { dot: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", label: "Healthy" },
  running: { dot: "bg-blue-500 animate-pulse", label: "Running" },
  stuck: { dot: "bg-orange-500", label: "Stuck" },
  failing: { dot: "bg-rose-500", label: "Failing" },
  idle: { dot: "bg-gray-400", label: "Idle" },
  disabled: { dot: "bg-gray-300", label: "Disabled" },
};

export default function AgentsClient() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/agents");
    const data = await res.json();
    setAgents(res.ok ? data.agents : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sync() {
    setBusy("sync");
    const res = await fetch("/api/admin/agents", { method: "POST" });
    const data = await res.json();
    setMsg(res.ok ? `Synced ${data.synced} agent(s)` : `Sync failed: ${data.error}`);
    setBusy(null);
    load();
  }

  async function run(slug: string) {
    setBusy(slug);
    const res = await fetch(`/api/agents/${slug}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setMsg(res.ok ? `Run queued (${data.runId?.slice(0, 8)}…)` : `Run failed: ${data.error}`);
    setBusy(null);
    load();
  }

  async function setStatus(slug: string, status: string) {
    setBusy(slug);
    const res = await fetch(`/api/admin/agents/${slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setMsg(res.ok ? `${slug} → ${status}` : "Update failed");
    setBusy(null);
    load();
  }

  async function del(slug: string) {
    if (!confirm(`Delete agent "${slug}"? Run history is removed too.`)) return;
    setBusy(slug);
    const res = await fetch(`/api/admin/agents/${slug}`, { method: "DELETE" });
    setMsg(res.ok ? `${slug} deleted` : "Delete forbidden (ADMIN only)");
    setBusy(null);
    load();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#11131D] dark:text-white">
          <Bot className="h-6 w-6 text-rose-500" /> Agents
        </h1>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-[#6C757D]">{msg}</span>}
          <button onClick={sync} disabled={busy === "sync"} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] hover:bg-[#EEF1F6] dark:hover:bg-white/5 disabled:opacity-50">
            <RefreshCw className="h-4 w-4" /> Sync from service
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[#6C757D]">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="p-8 text-center text-[#6C757D] rounded-xl border border-dashed border-[#D9DEE8] dark:border-[#2e3560]">
          No agents registered. Click <strong>Sync from service</strong> to import them from the agents service.
        </div>
      ) : (
        <div className="grid gap-4">
          {agents.map((a) => {
            const h = HEALTH[a.health] ?? HEALTH.idle;
            return (
              <div key={a.id} className="p-5 rounded-xl border border-[#D9DEE8] dark:border-[#2e3560] bg-white dark:bg-[#161a33]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${h.dot}`} title={h.label} />
                      <h2 className="font-semibold text-[#11131D] dark:text-white">{a.name}</h2>
                      <span className="font-mono text-xs text-[#6C757D]">{a.slug}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-[#6C757D]">{h.label}</span>
                    </div>
                    <p className="mt-1 text-sm text-[#6C757D]">{a.description}</p>
                    <p className="mt-2 text-xs text-[#9AA3B2]">
                      Trigger: {a.triggerType}{a.schedule ? ` (${a.schedule})` : ""} ·{" "}
                      {a.lastRun
                        ? `Last run: ${a.lastRun.status} — ${a.lastRun.itemsProduced} item(s)${a.lastRun.costUsd != null ? `, $${a.lastRun.costUsd.toFixed(2)}` : ""} · ${new Date(a.lastRun.createdAt).toLocaleString()}`
                        : "No runs yet"}
                    </p>
                    {a.lastRun?.error && <p className="mt-1 text-xs text-rose-500">Error: {a.lastRun.error}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button disabled={busy === a.slug || a.status !== "ENABLED"} onClick={() => run(a.slug)}
                      title={a.status !== "ENABLED" ? "Enable to run" : "Run now"}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-40">
                      <Play className="h-3.5 w-3.5" /> Run now
                    </button>
                    {a.status === "ENABLED" ? (
                      <button disabled={busy === a.slug} onClick={() => setStatus(a.slug, "DISABLED")} title="Disable"
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] hover:bg-[#EEF1F6] dark:hover:bg-white/5">
                        <Pause className="h-3.5 w-3.5" /> Disable
                      </button>
                    ) : (
                      <button disabled={busy === a.slug} onClick={() => setStatus(a.slug, "ENABLED")} title="Enable"
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-[#D9DEE8] dark:border-[#2e3560] hover:bg-[#EEF1F6] dark:hover:bg-white/5">
                        <Power className="h-3.5 w-3.5" /> Enable
                      </button>
                    )}
                    <button disabled={busy === a.slug} onClick={() => del(a.slug)} title="Delete"
                      className="inline-flex items-center px-2 py-1.5 text-xs rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {a.lastRun?.logTail && (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-[#0d1027] text-[#c7d0e0] text-[11px] p-3 whitespace-pre-wrap">{a.lastRun.logTail}</pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
