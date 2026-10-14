// src/lib/inference.ts
//
// One place to call an LLM from server code.
//
// Extracted from the inline fetch in src/app/api/onboarding/[slug]/route.ts,
// which is the proven-working setup (OpenRouter + gemini-2.5-flash + forced JSON).
// Keeping the provider details here means a model or provider change is one edit
// rather than a grep across route handlers.

import prisma from "@/lib/prisma";
import {
  AI_FEATURES,
  DEFAULT_MODEL,
  aiModelSecretKey,
  type AiFeature,
} from "@/lib/ai/features";
import { getSecret } from "@/lib/secrets";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export { DEFAULT_MODEL } from "@/lib/ai/features";

export class InferenceNotConfiguredError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not configured (checked the Integrations store and env)");
    this.name = "InferenceNotConfiguredError";
  }
}

/**
 * Resolved per call, never at module scope: `next build` evaluates route modules
 * with no env at all, so a module-level key read would fail the build gate.
 */
async function apiKey(): Promise<string | null> {
  const key = (await getSecret("OPENROUTER_API_KEY")) ?? process.env.OPENROUTER_API_KEY;
  const trimmed = (key ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when an LLM call could succeed — lets callers degrade instead of throwing. */
export async function isInferenceConfigured(): Promise<boolean> {
  return (await apiKey()) !== null;
}

export type ChatCompleteOptions = {
  feature: AiFeature;
  system: string;
  user: string;
  model?: string;
  /** Ask the provider for a JSON object and strip any markdown fence it adds. */
  json?: boolean;
  /** Abort rather than hang a request behind a slow model. */
  timeoutMs?: number;
};

/**
 * Single-turn completion. Returns the raw assistant text (fences stripped when
 * `json` is set) — parsing and validating the shape is the caller's job, since
 * only the caller knows what shape it asked for.
 */
export async function chatComplete(opts: ChatCompleteOptions): Promise<string> {
  const key = await apiKey();
  if (!key) throw new InferenceNotConfiguredError();

  const configuredModel = (await getSecret(aiModelSecretKey(opts.feature)))?.trim();
  const featureDefault = AI_FEATURES.find((feature) => feature.key === opts.feature)?.defaultModel;
  const model = opts.model?.trim() || configuredModel || featureDefault || DEFAULT_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        usage: { include: true },
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenRouter API error (${res.status}): ${(await res.text()).slice(0, 500)}`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch (error) {
      throw new Error("OpenRouter returned invalid JSON", { cause: error });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("OpenRouter returned an invalid response object");
    }

    const response = data as Record<string, unknown>;
    const choices = response.choices;
    const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
    const message =
      firstChoice && typeof firstChoice === "object" && !Array.isArray(firstChoice)
        ? (firstChoice as Record<string, unknown>).message
        : undefined;
    const content =
      message && typeof message === "object" && !Array.isArray(message)
        ? (message as Record<string, unknown>).content
        : undefined;
    if (typeof content !== "string") throw new Error("OpenRouter returned no text content");

    const usage =
      response.usage && typeof response.usage === "object" && !Array.isArray(response.usage)
        ? (response.usage as Record<string, unknown>)
        : {};
    const numericUsage = (field: string): number => {
      const value = usage[field];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };

    // Cost telemetry must never break or delay an AI feature.
    void prisma.aiUsage
      .create({
        data: {
          feature: opts.feature,
          model,
          promptTokens: numericUsage("prompt_tokens"),
          completionTokens: numericUsage("completion_tokens"),
          costUsd: numericUsage("cost"),
        },
      })
      .catch((error: unknown) => {
        console.error("Failed to record AI usage", { feature: opts.feature, model, error });
      });

    // Models still emit ```json fences even with response_format set.
    return opts.json
      ? content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/g, "").trim()
      : content.trim();
  } finally {
    clearTimeout(timeout);
  }
}
