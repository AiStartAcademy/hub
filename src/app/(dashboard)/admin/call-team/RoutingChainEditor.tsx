"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import type { RingStrategy, RouteStep } from "@/lib/calls/inboundRouting";

type RoutingChainEditorProps = {
  initialSteps: RouteStep[];
  initialRingStrategy: RingStrategy;
  hasVapiNumber: boolean;
  hasForwardNumber: boolean;
  vapiLoopWarning: boolean;
  forwardLoopWarning: boolean;
};

type SaveResponse = {
  ok: true;
  key: string;
  action: "create" | "update";
};

const STEP_DETAILS: Record<RouteStep, { label: string; description: string }> = {
  owner: {
    label: "Contact owner",
    description: "Calls the assigned staff owner first when they are available.",
  },
  closers: {
    label: "Available call team",
    description: "Calls available team members using the selected ring strategy.",
  },
  vapi: {
    label: "Vapi assistant",
    description: "Forwards the call to the configured Vapi inbound number.",
  },
  forward: {
    label: "Forwarding number",
    description: "Forwards the call to the configured external fallback number.",
  },
};

const ALL_STEPS = Object.keys(STEP_DETAILS) as RouteStep[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSaveResponse(value: unknown, expectedKey: string): value is SaveResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    value.key === expectedKey &&
    (value.action === "create" || value.action === "update")
  );
}

function errorMessage(value: unknown, status: number): string {
  if (isRecord(value) && typeof value.error === "string" && value.error.length > 0) {
    return value.error;
  }
  return `Request failed with status ${status}`;
}

async function saveConfig(key: string, value: string): Promise<void> {
  const response = await fetch("/api/admin/integrations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, kind: "config", category: "comms" }),
  });

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      response.ok
        ? "The server returned an invalid response"
        : `Request failed with status ${response.status}`,
    );
  }

  if (!response.ok) throw new Error(errorMessage(result, response.status));
  if (!isSaveResponse(result, key)) throw new Error("The server returned an invalid response");
}

function initialOrder(steps: readonly RouteStep[]): RouteStep[] {
  const unique = [...new Set(steps)];
  return [...unique, ...ALL_STEPS.filter((step) => !unique.includes(step))];
}

export default function RoutingChainEditor({
  initialSteps,
  initialRingStrategy,
  hasVapiNumber,
  hasForwardNumber,
  vapiLoopWarning,
  forwardLoopWarning,
}: RoutingChainEditorProps) {
  const startingOrder = useMemo(() => initialOrder(initialSteps), [initialSteps]);
  const [order, setOrder] = useState<RouteStep[]>(startingOrder);
  const [enabled, setEnabled] = useState<Set<RouteStep>>(() => new Set(initialSteps));
  const [ringStrategy, setRingStrategy] = useState<RingStrategy>(initialRingStrategy);
  const [savedSteps, setSavedSteps] = useState<RouteStep[]>(initialSteps);
  const [savedRingStrategy, setSavedRingStrategy] =
    useState<RingStrategy>(initialRingStrategy);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const draftSteps = order.filter((step) => enabled.has(step));
  const routeChanged = JSON.stringify(draftSteps) !== JSON.stringify(savedSteps);
  const strategyChanged = ringStrategy !== savedRingStrategy;
  const changed = routeChanged || strategyChanged;

  function moveStep(index: number, direction: -1 | 1): void {
    const destination = index + direction;
    if (destination < 0 || destination >= order.length) return;
    setOrder((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function toggleStep(step: RouteStep): void {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }

  function save(): void {
    const previousSteps = [...savedSteps];
    const previousStrategy = savedRingStrategy;
    const nextSteps = [...draftSteps];
    const nextStrategy = ringStrategy;
    setError(null);
    setSavedSteps(nextSteps);
    setSavedRingStrategy(nextStrategy);

    startTransition(async () => {
      try {
        if (routeChanged) {
          await saveConfig("INBOUND_ROUTE_CHAIN", JSON.stringify(nextSteps));
        }
        if (strategyChanged) {
          await saveConfig("CLOSER_RING_STRATEGY", nextStrategy);
        }
      } catch (saveError) {
        setOrder(initialOrder(previousSteps));
        setEnabled(new Set(previousSteps));
        setRingStrategy(previousStrategy);
        setSavedSteps(previousSteps);
        setSavedRingStrategy(previousStrategy);
        setError(saveError instanceof Error ? saveError.message : "Failed to save routing settings");
      }
    });
  }

  return (
    <section
      aria-labelledby="routing-chain-heading"
      className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-5">
        <h2 id="routing-chain-heading" className="text-lg font-bold text-slate-900 dark:text-white">
          Inbound routing chain
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Calls try each enabled step from top to bottom. Voicemail is always the final fallback
          and cannot be disabled.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {error}
        </div>
      ) : null}

      <ol className="space-y-3">
        {order.map((step, index) => {
          const active = enabled.has(step);
          const missingNumber =
            (step === "vapi" && !hasVapiNumber) ||
            (step === "forward" && !hasForwardNumber);
          const loopWarning =
            (step === "vapi" && vapiLoopWarning) ||
            (step === "forward" && forwardLoopWarning);
          return (
            <li
              key={step}
              className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {index + 1}. {STEP_DETAILS[step].label}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {STEP_DETAILS[step].description}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${STEP_DETAILS[step].label} up`}
                    disabled={isPending || index === 0}
                    onClick={() => moveStep(index, -1)}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${STEP_DETAILS[step].label} down`}
                    disabled={isPending || index === order.length - 1}
                    onClick={() => moveStep(index, 1)}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    aria-label={`${active ? "Disable" : "Enable"} ${STEP_DETAILS[step].label}`}
                    disabled={isPending}
                    onClick={() => toggleStep(step)}
                    className="inline-flex min-h-[44px] items-center gap-2 px-2 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {active ? "Enabled" : "Disabled"}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        active ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                          active ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </div>
              </div>
              {active && (missingNumber || loopWarning) ? (
                <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                  {loopWarning
                    ? "This number matches the Twilio inbound number and would create a call loop. "
                    : "This routing number is not configured. "}
                  <Link href="/admin/integrations" className="underline underline-offset-2">
                    Review integrations
                  </Link>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <fieldset className="mt-5">
        <legend className="font-semibold text-slate-900 dark:text-white">Call-team ring strategy</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(["simulring", "round-robin"] as const).map((strategy) => (
            <button
              key={strategy}
              type="button"
              role="radio"
              aria-checked={ringStrategy === strategy}
              disabled={isPending}
              onClick={() => setRingStrategy(strategy)}
              className={`min-h-[44px] rounded-xl border px-4 py-2 text-left text-sm font-semibold disabled:cursor-wait disabled:opacity-60 ${
                ringStrategy === strategy
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {strategy === "simulring" ? "Simultaneous ring" : "Round robin"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Simultaneous ring calls all available team members together; round robin calls them one
          at a time, starting with the least recently answered.
        </p>
      </fieldset>

      <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center dark:border-slate-800">
        <p className="flex-1 text-xs text-slate-500 dark:text-slate-400">
          Changes take effect within about 30 seconds across instances.
        </p>
        <button
          type="button"
          disabled={isPending || !changed}
          onClick={save}
          className="min-h-[44px] rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save routing"}
        </button>
      </div>
    </section>
  );
}
