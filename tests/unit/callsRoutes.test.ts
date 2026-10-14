import { beforeEach, describe, expect, it } from "bun:test";

import {
  createCallPatchHandler,
  createCallRecordingGetHandler,
  createCallsGetHandler,
} from "@/lib/calls/routeHandlers";

type Row = Record<string, unknown>;

const TOKEN = "test-hub-token";
const SID = `RE${"ab".repeat(16)}`;
const calls: Row[] = [];
const listQueries: Row[] = [];

function authorize(request: Request): Promise<Response | null> {
  const allowed = request.headers.get("authorization") === `Bearer ${TOKEN}`;
  return Promise.resolve(allowed ? null : Response.json({ error: "Unauthorized" }, { status: 401 }));
}

function request(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...init?.headers },
  });
}

function seed(): void {
  listQueries.length = 0;
  calls.length = 0;
  calls.push(
    {
      id: "call-empty",
      provider: "twilio",
      providerCallId: `CA${"01".repeat(16)}`,
      direction: "OUTBOUND",
      status: "COMPLETED",
      durationSec: 60,
      startedAt: new Date("2026-10-01T12:00:00.000Z"),
      recordingUrl: `/api/twilio/recordings/${SID}`,
      transcript: "",
      contactId: "contact-1",
      authorLabel: "Lex",
      contact: { name: "Ada" },
    },
    {
      id: "call-full",
      provider: "twilio",
      providerCallId: `CA${"02".repeat(16)}`,
      direction: "INBOUND",
      status: "COMPLETED",
      durationSec: 90,
      startedAt: new Date("2026-10-02T12:00:00.000Z"),
      recordingUrl: `/api/twilio/recordings/${SID}`,
      transcript: "existing transcript",
      contactId: "contact-2",
      authorLabel: null,
      contact: { name: "Grace" },
    },
  );
}

const getCalls = createCallsGetHandler({
  authorize,
  findCalls: async (query) => {
    listQueries.push(query as Row);
    const filtered = calls.filter((call) => {
      if (query.provider !== call.provider) return false;
      if (query.providerCallId && query.providerCallId !== call.providerCallId) return false;
      if (query.needsTranscript && call.transcript !== null && call.transcript !== "") return false;
      return !query.needsTranscript || call.recordingUrl !== null;
    });
    return filtered.slice(0, query.limit + 1) as never;
  },
});

const patchCall = createCallPatchHandler({
  authorize,
  writesEnabled: async () => true,
  findCall: async (id) => calls.find((call) => call.id === id) as never ?? null,
  updateCall: async (id, data) => {
    const call = calls.find((row) => row.id === id);
    if (!call) throw new Error("missing fixture");
    Object.assign(call, data);
  },
});

describe("internal calls MCP routes", () => {
  beforeEach(seed);

  it("SC2.1: rejects missing and wrong machine tokens", async () => {
    for (const headers of [undefined, { authorization: "Bearer wrong" }]) {
      const response = await getCalls(new Request("https://hub.test/api/internal/mcp/v1/calls", { headers }));
      expect(response.status).toBe(401);
    }
    expect(listQueries).toHaveLength(0);
  });

  it("SC2.2: needsTranscript returns only recorded calls with empty transcripts and no transcript body", async () => {
    const response = await getCalls(request("https://hub.test/api/internal/mcp/v1/calls?needsTranscript=1"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Row[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "call-empty",
      recordingSid: SID,
      hasTranscript: false,
      contactName: "Ada",
    });
    expect(JSON.stringify(body)).not.toContain("transcript\"");
    expect(JSON.stringify(body)).not.toContain("phone");
    expect(listQueries[0]).toMatchObject({ needsTranscript: true, provider: "twilio", limit: 50 });
  });

  it("SC2.3: PATCH refuses overwrite without force and permits it with force", async () => {
    const denied = await patchCall(
      request("https://hub.test/api/internal/mcp/v1/calls/call-full", {
        method: "PATCH",
        body: JSON.stringify({ transcript: "replacement" }),
      }),
      { params: Promise.resolve({ id: "call-full" }) },
    );
    expect(denied.status).toBe(409);
    expect(calls[1]?.transcript).toBe("existing transcript");

    const allowed = await patchCall(
      request("https://hub.test/api/internal/mcp/v1/calls/call-full", {
        method: "PATCH",
        body: JSON.stringify({ transcript: "replacement", force: true }),
      }),
      { params: Promise.resolve({ id: "call-full" }) },
    );
    expect(allowed.status).toBe(200);
    expect(calls[1]?.transcript).toBe("replacement");
  });

  it("SC2.4: PATCH returns 404 for an unknown call id", async () => {
    const response = await patchCall(
      request("https://hub.test/api/internal/mcp/v1/calls/missing", {
        method: "PATCH",
        body: JSON.stringify({ summary: "summary" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("internal call recording MCP route", () => {
  beforeEach(seed);

  it("SC2.5: returns 404 for missing call/recording, 400 for malformed SID, and 502 upstream", async () => {
    const handler = createCallRecordingGetHandler({
      authorize,
      findCall: async (id) => {
        if (id === "missing") return null;
        if (id === "none") return { recordingUrl: null };
        if (id === "bad") return { recordingUrl: "/api/twilio/recordings/not-a-sid" };
        return { recordingUrl: `/api/twilio/recordings/${SID}` };
      },
      getCredentials: async () => ({ accountSid: `AC${"cd".repeat(16)}`, authToken: "secret" }),
      fetchRecording: async () => new Response("do not leak this upstream body", { status: 500 }),
    });

    for (const id of ["missing", "none"]) {
      const response = await handler(request(`https://hub.test/calls/${id}/recording`), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(404);
    }
    expect(
      (await handler(request("https://hub.test/calls/bad/recording"), {
        params: Promise.resolve({ id: "bad" }),
      })).status,
    ).toBe(400);
    const upstream = await handler(request("https://hub.test/calls/good/recording"), {
      params: Promise.resolve({ id: "good" }),
    });
    expect(upstream.status).toBe(502);
    const upstreamErrorBody = await upstream.text();
    expect(upstreamErrorBody).not.toContain("do not leak");
    expect(upstreamErrorBody).not.toContain("secret");
  });
});
