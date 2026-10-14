"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Video } from "lucide-react";

/**
 * Provision the Zoom meeting for a series, or re-pull its occurrences.
 *
 * Separate from the schedule form on purpose: provisioning mints a real recurring
 * meeting on the shared Zoom host account, so it takes its own deliberate click.
 */
export default function ZoomPanel({
  seriesId,
  zoomLink,
}: {
  seriesId: string;
  zoomLink: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "provision" | "sync">(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function call(action: "provision" | "sync") {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/session-series/${seriesId}/zoom`, {
        method: action === "provision" ? "POST" : "PUT",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "err", text: data.error ?? "Something went wrong" });
      } else {
        setMessage({
          kind: "ok",
          text:
            action === "provision"
              ? `Zoom meeting created · ${data.synced ?? 0} occurrences synced`
              : `${data.synced ?? 0} occurrences synced`,
        });
        router.refresh();
      }
    } catch {
      setMessage({ kind: "err", text: "Network error — nothing was changed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {zoomLink ? (
        <>
          <a
            href={zoomLink}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1.5"
          >
            <Video className="h-4 w-4" /> Join link
          </a>
          <button
            type="button"
            onClick={() => call("sync")}
            disabled={busy !== null}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === "sync" ? "Syncing…" : "Sync from Zoom"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => call("provision")}
          disabled={busy !== null}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy === "provision" ? "Creating…" : "Create Zoom meeting"}
        </button>
      )}
      {message && (
        <span className={`text-xs ${message.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
