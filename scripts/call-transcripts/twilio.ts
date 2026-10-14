import { promises as fs } from "node:fs";

import { buildRecordingsPageUrl, resolveTwilioPageUrl } from "./core";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_SIZE = 1000;

export interface TwilioRecording {
  sid: string;
  callSid: string;
  dateCreated: string;
  durationSec: number;
  channels: number;
}

export interface TwilioCall {
  sid: string;
  parentCallSid: string | null;
  to: string;
  from: string;
  direction: string;
  startTime: string;
}

export interface TwilioCallWithParent {
  call: TwilioCall;
  parent: TwilioCall | null;
}

interface TwilioRecordingsPage {
  recordings: TwilioRecording[];
  nextPageUri: string | null;
}

function objectValue(value: unknown, description: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Twilio response: ${description} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Twilio response: ${description} must be a non-empty string`);
  }
  return value;
}

function nullableStringValue(value: unknown, description: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return stringValue(value, description);
}

function numericValue(value: unknown, description: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid Twilio response: ${description} must be a non-negative number`);
  }
  return parsed;
}

function parseRecording(value: unknown, index: number): TwilioRecording {
  const record = objectValue(value, `recordings[${index}]`);
  return {
    sid: stringValue(record.sid, `recordings[${index}].sid`),
    callSid: stringValue(record.call_sid, `recordings[${index}].call_sid`),
    dateCreated: stringValue(record.date_created, `recordings[${index}].date_created`),
    durationSec: numericValue(record.duration, `recordings[${index}].duration`),
    channels: numericValue(record.channels, `recordings[${index}].channels`),
  };
}

function parseRecordingsPage(value: unknown): TwilioRecordingsPage {
  const page = objectValue(value, "recordings page");
  if (!Array.isArray(page.recordings)) {
    throw new Error("Invalid Twilio response: recordings must be an array");
  }
  return {
    recordings: page.recordings.map(parseRecording),
    nextPageUri: nullableStringValue(page.next_page_uri, "next_page_uri"),
  };
}

function parseCall(value: unknown): TwilioCall {
  const call = objectValue(value, "call");
  return {
    sid: stringValue(call.sid, "call.sid"),
    parentCallSid: nullableStringValue(call.parent_call_sid, "call.parent_call_sid"),
    to: stringValue(call.to, "call.to"),
    from: stringValue(call.from, "call.from"),
    direction: stringValue(call.direction, "call.direction"),
    startTime: stringValue(call.start_time, "call.start_time"),
  };
}

export class TwilioClient {
  private readonly authorization: string;

  public constructor(
    private readonly accountSid: string,
    authToken: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    if (!accountSid || !authToken) {
      throw new Error("Twilio credentials must be non-empty");
    }
    this.authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }

  private async request(url: string): Promise<Response> {
    const response = await fetch(url, {
      headers: { Authorization: this.authorization },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Twilio request failed with status ${response.status}`);
    }
    return response;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.request(url);
    try {
      return await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Twilio returned invalid JSON: ${message}`);
    }
  }

  public async listRecordings(pageSize = DEFAULT_PAGE_SIZE): Promise<TwilioRecording[]> {
    const recordings: TwilioRecording[] = [];
    let pageUrl: string | null = buildRecordingsPageUrl(this.accountSid, pageSize);

    while (pageUrl !== null) {
      const page = parseRecordingsPage(await this.getJson(pageUrl));
      recordings.push(...page.recordings);
      pageUrl = page.nextPageUri === null ? null : resolveTwilioPageUrl(page.nextPageUri);
    }
    return recordings;
  }

  public async downloadRecording(recordingSid: string, destinationPath: string): Promise<void> {
    const url = new URL(
      `/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Recordings/${encodeURIComponent(recordingSid)}.wav`,
      "https://api.twilio.com",
    );
    url.searchParams.set("RequestedChannels", "2");
    const response = await this.request(url.toString());
    await fs.writeFile(destinationPath, new Uint8Array(await response.arrayBuffer()));
  }

  private async fetchCall(callSid: string): Promise<TwilioCall> {
    const url = new URL(
      `/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Calls/${encodeURIComponent(callSid)}.json`,
      "https://api.twilio.com",
    );
    return parseCall(await this.getJson(url.toString()));
  }

  public async getCall(callSid: string): Promise<TwilioCallWithParent> {
    const call = await this.fetchCall(callSid);
    const parent = call.parentCallSid === null ? null : await this.fetchCall(call.parentCallSid);
    return { call, parent };
  }
}
