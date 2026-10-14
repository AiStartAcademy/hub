import {
  parseCallListQuery,
  parseRecordingSid,
  validateCallPatch,
  type CallListQuery,
  type CallPatch,
} from "@/lib/calls/internalApi";
import { logger } from "@/lib/logger";
import { MCP_LIST_MAX_BYTES, mcpError, mcpJson, mcpJsonLimited } from "@/lib/mcpApi";

export interface CallListRow {
  id: string;
  provider: string;
  providerCallId: string | null;
  direction: string;
  status: string;
  durationSec: number | null;
  startedAt: Date | null;
  recordingUrl: string | null;
  transcript: string | null;
  contactId: string;
  authorLabel: string | null;
  contact: { name: string };
}

export interface CallsGetDependencies {
  authorize(request: Request): Promise<Response | null>;
  findCalls(query: CallListQuery): Promise<CallListRow[]>;
}

export interface CallPatchDependencies {
  authorize(request: Request): Promise<Response | null>;
  writesEnabled(): Promise<boolean>;
  findCall(id: string): Promise<{ transcript: string | null } | null>;
  updateCall(id: string, data: Omit<CallPatch, "force">): Promise<void>;
}

export interface CallRecordingDependencies {
  authorize(request: Request): Promise<Response | null>;
  findCall(id: string): Promise<{ recordingUrl: string | null } | null>;
  getCredentials(): Promise<{ accountSid: string; authToken: string }>;
  fetchRecording(url: string, init: RequestInit): Promise<Response>;
}

const TWILIO_FETCH_TIMEOUT_MS = 30_000;

export function createCallsGetHandler(deps: CallsGetDependencies) {
  return async function callsGet(request: Request): Promise<Response> {
    const denied = await deps.authorize(request);
    if (denied) return denied;

    const parsed = parseCallListQuery(new URL(request.url));
    if (!parsed.ok) return mcpError(parsed.error, 400);

    try {
      const rows = await deps.findCalls(parsed.value);
      const hasMore = rows.length > parsed.value.limit;
      const page = rows.slice(0, parsed.value.limit);
      const items = page.map((row) => ({
        id: row.id,
        providerCallId: row.providerCallId,
        direction: row.direction,
        status: row.status,
        durationSec: row.durationSec,
        startedAt: row.startedAt,
        recordingSid: parseRecordingSid(row.recordingUrl),
        hasTranscript: Boolean(row.transcript),
        contactId: row.contactId,
        contactName: row.contact.name,
        authorLabel: row.authorLabel,
      }));
      return mcpJsonLimited(
        {
          items,
          nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
          hasMore,
        },
        MCP_LIST_MAX_BYTES,
      );
    } catch (error) {
      const correlationId = crypto.randomUUID();
      logger.error(
        { correlationId, errorName: error instanceof Error ? error.name : "unknown" },
        "[mcp calls] list failed",
      );
      return mcpJson({ error: "Call query failed", correlationId }, 500);
    }
  };
}

export function createCallPatchHandler(deps: CallPatchDependencies) {
  return async function callPatch(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const denied = await deps.authorize(request);
    if (denied) return denied;
    if (!(await deps.writesEnabled())) {
      return mcpError("MCP writes are disabled (HUB_MCP_WRITES_ENABLED)", 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mcpError("Invalid JSON body", 400);
    }
    const parsed = validateCallPatch(body);
    if (!parsed.ok) return mcpError(parsed.error, 400);

    const { id } = await params;
    try {
      const existing = await deps.findCall(id);
      if (!existing) return mcpError("Call not found", 404);
      if (
        parsed.value.transcript !== undefined &&
        existing.transcript !== null &&
        existing.transcript !== "" &&
        !parsed.value.force
      ) {
        return mcpError("Call already has a transcript; pass force=true to overwrite", 409);
      }

      const data: Omit<CallPatch, "force"> = {
        ...(parsed.value.transcript !== undefined ? { transcript: parsed.value.transcript } : {}),
        ...(parsed.value.summary !== undefined ? { summary: parsed.value.summary } : {}),
        ...(parsed.value.analysis !== undefined ? { analysis: parsed.value.analysis } : {}),
      };
      await deps.updateCall(id, data);
      logger.info(
        {
          callId: id,
          transcriptLength: data.transcript?.length,
          summaryLength: data.summary?.length,
          analysisLength: data.analysis?.length,
        },
        "[mcp calls] call text fields updated",
      );
      return mcpJson({ ok: true, id });
    } catch (error) {
      const correlationId = crypto.randomUUID();
      logger.error(
        { callId: id, correlationId, errorName: error instanceof Error ? error.name : "unknown" },
        "[mcp calls] patch failed",
      );
      return mcpJson({ error: "Call update failed", correlationId }, 500);
    }
  };
}

export function createCallRecordingGetHandler(deps: CallRecordingDependencies) {
  return async function callRecordingGet(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const denied = await deps.authorize(request);
    if (denied) return denied;

    const { id } = await params;
    try {
      const call = await deps.findCall(id);
      if (!call || call.recordingUrl === null) return mcpError("Recording not found", 404);
      const recordingSid = parseRecordingSid(call.recordingUrl);
      if (!recordingSid) return mcpError("Malformed Twilio recording SID", 400);

      const { accountSid, authToken } = await deps.getCredentials();
      const authorization = Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64");
      const url = new URL(
        `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings/${recordingSid}.wav`,
        "https://api.twilio.com",
      );
      url.searchParams.set("RequestedChannels", "2");
      const upstream = await deps.fetchRecording(url.toString(), {
        headers: { Authorization: `Basic ${authorization}` },
        signal: AbortSignal.timeout(TWILIO_FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        logger.error(
          { callId: id, recordingSid, upstreamStatus: upstream.status },
          "[mcp calls] recording upstream failed",
        );
        return mcpError("Unable to fetch recording", 502);
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const correlationId = crypto.randomUUID();
      logger.error(
        { callId: id, correlationId, errorName: error instanceof Error ? error.name : "unknown" },
        "[mcp calls] recording request failed",
      );
      return mcpError("Unable to fetch recording", 502);
    }
  };
}
