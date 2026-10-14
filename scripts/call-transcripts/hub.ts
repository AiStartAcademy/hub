import { promises as fs } from "node:fs";

import {
  buildHubCallPatchUrl,
  buildHubCallsUrl,
  buildHubRecordingUrl,
  type HubCallsUrlOptions,
} from "./core";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HubCall {
  id: string;
  providerCallId: string | null;
  direction: string;
  status: string;
  durationSec: number | null;
  startedAt: string | null;
  recordingSid: string | null;
  hasTranscript: boolean;
  contactId: string;
  contactName: string;
  authorLabel: string | null;
}

interface HubCallsPage {
  items: HubCall[];
  nextCursor: string | null;
  hasMore: boolean;
}

function record(value: unknown, description: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid hub response: ${description} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid hub response: ${description} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, description: string): string | null {
  return value === null ? null : requiredString(value, description);
}

function parseCall(value: unknown, index: number): HubCall {
  const item = record(value, `items[${index}]`);
  if (typeof item.hasTranscript !== "boolean") {
    throw new Error(`Invalid hub response: items[${index}].hasTranscript must be boolean`);
  }
  if (item.durationSec !== null && (typeof item.durationSec !== "number" || item.durationSec < 0)) {
    throw new Error(`Invalid hub response: items[${index}].durationSec must be non-negative or null`);
  }
  return {
    id: requiredString(item.id, `items[${index}].id`),
    providerCallId: nullableString(item.providerCallId, `items[${index}].providerCallId`),
    direction: requiredString(item.direction, `items[${index}].direction`),
    status: requiredString(item.status, `items[${index}].status`),
    durationSec: item.durationSec as number | null,
    startedAt: nullableString(item.startedAt, `items[${index}].startedAt`),
    recordingSid: nullableString(item.recordingSid, `items[${index}].recordingSid`),
    hasTranscript: item.hasTranscript,
    contactId: requiredString(item.contactId, `items[${index}].contactId`),
    contactName: requiredString(item.contactName, `items[${index}].contactName`),
    authorLabel: nullableString(item.authorLabel, `items[${index}].authorLabel`),
  };
}

function parsePage(value: unknown): HubCallsPage {
  const page = record(value, "calls page");
  if (!Array.isArray(page.items)) throw new Error("Invalid hub response: items must be an array");
  if (typeof page.hasMore !== "boolean") {
    throw new Error("Invalid hub response: hasMore must be boolean");
  }
  return {
    items: page.items.map(parseCall),
    nextCursor: nullableString(page.nextCursor, "nextCursor"),
    hasMore: page.hasMore,
  };
}

export class HubClient {
  public constructor(
    private readonly hubUrl: string,
    private readonly token: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!hubUrl || !token) throw new Error("HUB_URL and HUB_MCP_TOKEN must be non-empty");
  }

  private async request(url: string, init: RequestInit = {}, context: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown error";
      throw new Error(`Hub ${context} request failed (${name})`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Hub ${context} request failed with status ${response.status}`);
    }
    return response;
  }

  private async callsPage(options: HubCallsUrlOptions): Promise<HubCallsPage> {
    const response = await this.request(buildHubCallsUrl(this.hubUrl, options), {}, "call list");
    try {
      return parsePage(await response.json());
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown parse error";
      throw new Error(`Hub call list returned invalid JSON (${message})`);
    }
  }

  public async listCalls(options: HubCallsUrlOptions): Promise<HubCall[]> {
    const calls: HubCall[] = [];
    const seenCursors = new Set<string>();
    let cursor = options.cursor;
    do {
      const page = await this.callsPage({ ...options, ...(cursor ? { cursor } : {}) });
      calls.push(...page.items);
      if (!page.hasMore) break;
      if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
        throw new Error("Hub call list returned an invalid pagination cursor");
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (true);
    return calls;
  }

  public async downloadRecording(id: string, destinationPath: string): Promise<void> {
    const response = await this.request(
      buildHubRecordingUrl(this.hubUrl, id),
      {},
      `recording download for call ${id}`,
    );
    await fs.writeFile(destinationPath, new Uint8Array(await response.arrayBuffer()));
  }

  public async patchTranscript(id: string, transcript: string, force = false): Promise<void> {
    const response = await this.request(
      buildHubCallPatchUrl(this.hubUrl, id),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, ...(force ? { force: true } : {}) }),
      },
      `transcript writeback for call ${id}`,
    );
    await response.body?.cancel();
  }

  public async findByProviderCallId(providerCallId: string): Promise<HubCall> {
    const matches = await this.listCalls({ provider: "twilio", providerCallId, limit: 2 });
    if (matches.length === 0) throw new Error(`Hub has no call for providerCallId ${providerCallId}`);
    if (matches.length > 1) throw new Error(`Hub returned multiple calls for providerCallId ${providerCallId}`);
    return matches[0] as HubCall;
  }
}
