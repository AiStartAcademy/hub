import { beforeEach, describe, expect, it, mock } from "bun:test";

// getSecret is prisma-backed; mock at that boundary so the real DB → env → none
// resolution order runs.
let secretRow: { kind: string; valuePlain: string | null } | null = null;

// Only OPENROUTER_API_KEY is stubbed as present. The per-feature AI_MODEL_* config
// lookup must miss so these tests exercise the feature-default → DEFAULT_MODEL path.
mock.module("@/lib/prisma", () => ({
  default: {
    secret: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key === "OPENROUTER_API_KEY" ? secretRow : null,
    },
    // chatComplete records usage fire-and-forget; swallow it so the assertions
    // below stay about the completion itself.
    aiUsage: { create: async () => ({}) },
  },
}));

const { chatComplete, isInferenceConfigured, InferenceNotConfiguredError, DEFAULT_MODEL } =
  await import("@/lib/inference");
const { parseStoredBrief } = await import("@/lib/leads/brief");
const { bustSecretCache } = await import("@/lib/secrets");

const realFetch = globalThis.fetch;

function useKey(value: string | null) {
  secretRow = value === null ? null : { kind: "config", valuePlain: value };
  if (value === null) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = value;
  bustSecretCache("OPENROUTER_API_KEY");
}

/** Captures the outbound request and replies with `content`. */
function stubFetch(content: unknown, ok = true, status = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    });
    return {
      ok,
      status,
      text: async () => "upstream said no",
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  useKey("test-key");
  globalThis.fetch = realFetch;
});

describe("isInferenceConfigured", () => {
  it("reports false with no key, so callers can degrade instead of throwing", async () => {
    useKey(null);
    expect(await isInferenceConfigured()).toBe(false);
  });

  it("reports true once a key is present", async () => {
    expect(await isInferenceConfigured()).toBe(true);
  });

  it("treats a whitespace-only key as unset", async () => {
    useKey("   ");
    expect(await isInferenceConfigured()).toBe(false);
  });
});

describe("chatComplete", () => {
  it("throws a named error when unconfigured, rather than calling out", async () => {
    useKey(null);
    let threw: unknown;
    try {
      await chatComplete({ feature: "lead_brief", system: "s", user: "u" });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(InferenceNotConfiguredError);
  });

  it("sends system and user messages with the default model", async () => {
    const calls = stubFetch("hello");
    await chatComplete({ feature: "lead_brief", system: "be brief", user: "who?" });
    expect(calls[0].body.model).toBe(DEFAULT_MODEL);
    expect(calls[0].body.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "who?" },
    ]);
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
  });

  it("requests a JSON object only when json is set", async () => {
    let calls = stubFetch("{}");
    await chatComplete({ feature: "lead_brief", system: "s", user: "u", json: true });
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });

    calls = stubFetch("plain");
    await chatComplete({ feature: "lead_brief", system: "s", user: "u" });
    expect(calls[0].body.response_format).toBeUndefined();
  });

  it("strips markdown fences models add despite response_format", async () => {
    stubFetch('```json\n{"a":1}\n```');
    expect(await chatComplete({ feature: "lead_brief", system: "s", user: "u", json: true })).toBe('{"a":1}');
  });

  it("strips a bare fence too", async () => {
    stubFetch('```\n{"a":1}\n```');
    expect(await chatComplete({ feature: "lead_brief", system: "s", user: "u", json: true })).toBe('{"a":1}');
  });

  it("surfaces an upstream error with its status", async () => {
    stubFetch("", false, 429);
    await expect(chatComplete({ feature: "lead_brief", system: "s", user: "u" })).rejects.toThrow("429");
  });

  it("rejects a response with no text content", async () => {
    stubFetch({ not: "a string" });
    await expect(chatComplete({ feature: "lead_brief", system: "s", user: "u" })).rejects.toThrow("no text content");
  });
});

describe("parseStoredBrief", () => {
  it("returns null for missing or unparseable cached briefs", () => {
    expect(parseStoredBrief(null)).toBeNull();
    expect(parseStoredBrief("")).toBeNull();
    expect(parseStoredBrief("not json")).toBeNull();
  });

  it("round-trips a stored brief", () => {
    const stored = JSON.stringify({
      summary: "Founder wanting an agency.",
      engagement: "Clicked twice.",
      nextAction: "Call about the Sept cohort.",
      generatedAt: "2026-08-06T12:00:00.000Z",
    });
    expect(parseStoredBrief(stored)).toEqual({
      summary: "Founder wanting an agency.",
      engagement: "Clicked twice.",
      nextAction: "Call about the Sept cohort.",
      generatedAt: "2026-08-06T12:00:00.000Z",
    });
  });

  it("coerces non-string fields to empty rather than rendering junk", () => {
    const brief = parseStoredBrief(JSON.stringify({ summary: 42, engagement: null }));
    expect(brief).toEqual({ summary: "", engagement: "", nextAction: "", generatedAt: "" });
  });
});
