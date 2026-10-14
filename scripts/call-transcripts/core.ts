import { formatTimestamp, type Segment } from "../dub-audio/core";

export type Speaker = "Closer" | "Lead" | "Speaker";
export type EntityType = "PERSON" | "COMPANY" | "CITY";

export interface ChannelSegment extends Segment {
  channel: number;
  noSpeechProb?: number;
}

export interface TranscriptSegment {
  speaker: Speaker;
  start: number;
  end: number;
  text: string;
}

export interface Entity {
  text: string;
  type: EntityType;
}

export interface RedactionOptions {
  leadNames?: string[];
  closerNames?: string[];
}

export interface MappingRow {
  id: string;
  callSid: string;
  recordingSid: string;
  dialedNumber: string;
}

export interface CallIdentity {
  callSid: string;
  recordingSid: string;
  dialedNumber: string;
  startedAt: string;
}

export interface IndexRow extends CallIdentity {
  durationSec: string;
  direction: string;
  rawJsonPath: string;
}

export interface MarkdownInput {
  id: string;
  startedAt: string;
  durationSec: number;
  transcript: string;
}

export type CliOptions =
  | { command: "list" }
  | {
      command: "run";
      out: string;
      source: "twilio" | "hub";
      limit?: number;
      since?: string;
      minDuration: number;
      swapChannels: boolean;
      whisperCmd: string;
      model: string;
      force: boolean;
      noWriteback: boolean;
    }
  | { command: "push"; out: string }
  | {
      command: "anonymize";
      out: string;
      driveDir: string;
      namesCsv?: string;
      closerNames: string[];
      entitiesCmd?: string;
    };

const SILENCE_PHRASE_PATTERN = /^(?:thank you\.|thanks for watching!|subtitles by.*|you)$/i;
const TWILIO_API_ORIGIN = "https://api.twilio.com";
const DEFAULT_WHISPER_COMMAND = "uvx --from mlx-whisper mlx_whisper";
const DEFAULT_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacementTerms(names: string[]): string[] {
  const terms = new Set<string>();

  for (const rawName of names) {
    const name = rawName.trim();
    if (name.length === 0) {
      continue;
    }
    terms.add(name);
    for (const token of name.match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (token.length >= 3) {
        terms.add(token);
      }
    }
  }

  return [...terms].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

function replaceTerms(text: string, terms: string[], replacement: string): string {
  if (terms.length === 0) {
    return text;
  }

  const alternatives = terms.map(escapeRegExp).join("|");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  return text.replace(pattern, replacement);
}

export function filterHallucinations(segments: ChannelSegment[]): ChannelSegment[] {
  const repetitionByChannel = new Map<number, { text: string; count: number }>();
  const kept: ChannelSegment[] = [];

  for (const segment of segments) {
    const text = segment.text.trim();
    if (text.length === 0) {
      continue;
    }

    const previous = repetitionByChannel.get(segment.channel);
    const count = previous?.text === text ? previous.count + 1 : 1;
    repetitionByChannel.set(segment.channel, { text, count });

    if (count >= 3) {
      continue;
    }
    if ((segment.noSpeechProb ?? 0) > 0.6 && SILENCE_PHRASE_PATTERN.test(text)) {
      continue;
    }

    kept.push({ ...segment, text });
  }

  return kept;
}

/**
 * Whisper's segment-level start snaps to 0 (or the previous segment's end) when a channel
 * opens with silence, which is the normal state of one side of a phone call. Word-level
 * timestamps are accurate, so the first and last word bound the segment instead.
 */
export function wordSpan(rawSegment: unknown): { startSec: number; endSec: number } | undefined {
  if (rawSegment === null || typeof rawSegment !== "object" || !("words" in rawSegment)) {
    return undefined;
  }
  const words = (rawSegment as { words: unknown }).words;
  if (!Array.isArray(words) || words.length === 0) {
    return undefined;
  }
  const first = words[0] as { start?: unknown } | null;
  const last = words[words.length - 1] as { end?: unknown } | null;
  const startSec = first?.start;
  const endSec = last?.end;
  if (
    typeof startSec !== "number" ||
    !Number.isFinite(startSec) ||
    typeof endSec !== "number" ||
    !Number.isFinite(endSec)
  ) {
    return undefined;
  }
  return { startSec, endSec };
}

export function mergeChannelSegments(
  channel0: ChannelSegment[],
  channel1?: ChannelSegment[],
  swapChannels = false,
): TranscriptSegment[] {
  const isMono = channel1 === undefined;
  const labeled: TranscriptSegment[] = [...channel0, ...(channel1 ?? [])]
    .map((segment): TranscriptSegment => {
      let speaker: Speaker = "Speaker";
      if (!isMono) {
        const channelZeroSpeaker: Speaker = swapChannels ? "Lead" : "Closer";
        const channelOneSpeaker: Speaker = swapChannels ? "Closer" : "Lead";
        speaker = segment.channel === 0 ? channelZeroSpeaker : channelOneSpeaker;
      }
      return {
        speaker,
        start: segment.startSec,
        end: segment.endSec,
        text: segment.text.trim(),
      };
    })
    .filter((segment) => segment.text.length > 0)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: TranscriptSegment[] = [];
  for (const segment of labeled) {
    const previous = merged.at(-1);
    if (previous && previous.speaker === segment.speaker && segment.start - previous.end < 1) {
      previous.end = Math.max(previous.end, segment.end);
      previous.text = `${previous.text} ${segment.text}`;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

export function formatTranscriptTimestamp(seconds: number): string {
  const precise = formatTimestamp(seconds);
  const [hoursRaw = "0", minutesRaw = "0", secondsRaw = "0"] = precise.split(":");
  const totalMinutes = Number(hoursRaw) * 60 + Number(minutesRaw);
  return `[${String(totalMinutes).padStart(2, "0")}:${secondsRaw.slice(0, 2)}]`;
}

export function renderTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => `${formatTranscriptTimestamp(segment.start)} ${segment.speaker}: ${segment.text}`)
    .join("\n");
}

export function redactText(text: string, options: RedactionOptions = {}): string {
  let redacted = text;
  redacted = redacted.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]");
  redacted = redacted.replace(/\b(?:https?:\/\/|www\.)[^\s<]+/gi, "[URL]");
  redacted = redacted.replace(
    /(?<!\d)(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/g,
    "[PHONE]",
  );
  redacted = redacted.replace(
    /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,5}(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Way|Ct|Court)\b\.?/gi,
    "[ADDRESS]",
  );
  redacted = replaceTerms(redacted, replacementTerms(options.leadNames ?? []), "[LEAD]");
  redacted = replaceTerms(redacted, replacementTerms(options.closerNames ?? []), "[CLOSER]");
  return redacted;
}

export function parseEntitiesJson(json: string): Entity[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Entity command did not return valid JSON: ${message}`);
  }

  if (parsed === null || typeof parsed !== "object" || !("entities" in parsed)) {
    throw new Error("Invalid entity JSON: entities must be an array");
  }
  const entities = (parsed as { entities: unknown }).entities;
  if (!Array.isArray(entities)) {
    throw new Error("Invalid entity JSON: entities must be an array");
  }

  return entities.map((entry, index): Entity => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`Invalid entity JSON: entities[${index}] must be an object`);
    }
    const candidate = entry as { text?: unknown; type?: unknown };
    if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) {
      throw new Error(`Invalid entity JSON: entities[${index}].text must be a non-empty string`);
    }
    if (
      candidate.type !== "PERSON" &&
      candidate.type !== "COMPANY" &&
      candidate.type !== "CITY"
    ) {
      throw new Error(`Invalid entity JSON: entities[${index}].type must be PERSON, COMPANY, or CITY`);
    }
    return { text: candidate.text.trim(), type: candidate.type };
  });
}

export function redactEntities(text: string, entities: Entity[]): string {
  return [...entities]
    .sort((left, right) => right.text.length - left.text.length)
    .reduce(
      (result, entity) => replaceTerms(result, [entity.text], `[${entity.type}]`),
      text,
    );
}

export function findLeaks(text: string, knownNames: string[] = []): string[] {
  const leaks: string[] = [];
  if (/\d{7,}/.test(text.replace(/\[\d{2,}:\d{2}\]/g, ""))) {
    leaks.push("7+ digit run");
  }
  if (text.includes("@")) {
    leaks.push("@");
  }
  if (/https?:\/\/|\bwww\./i.test(text)) {
    leaks.push("http");
  }
  for (const term of replacementTerms(knownNames)) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    if (pattern.test(text)) {
      leaks.push(`known name: ${term}`);
    }
  }
  return leaks;
}

export function assignNeutralIds(
  existing: MappingRow[],
  calls: CallIdentity[],
): MappingRow[] {
  const result = existing.map((row) => ({ ...row }));
  const existingCallSids = new Set(existing.map((row) => row.callSid));
  let nextNumber = existing.reduce((maximum, row) => {
    const match = /^call-(\d+)$/.exec(row.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0) + 1;

  const newCalls = calls
    .filter((call) => !existingCallSids.has(call.callSid))
    .sort((left, right) => {
      const timeDifference = Date.parse(left.startedAt) - Date.parse(right.startedAt);
      return timeDifference || left.callSid.localeCompare(right.callSid);
    });

  for (const call of newCalls) {
    result.push({
      id: `call-${String(nextNumber).padStart(3, "0")}`,
      callSid: call.callSid,
      recordingSid: call.recordingSid,
      dialedNumber: call.dialedNumber,
    });
    nextNumber += 1;
  }
  return result;
}

export function buildRecordingsPageUrl(accountSid: string, pageSize: number): string {
  const url = new URL(
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings.json`,
    TWILIO_API_ORIGIN,
  );
  url.searchParams.set("PageSize", String(pageSize));
  return url.toString();
}

export function resolveTwilioPageUrl(nextPageUri: string): string {
  return new URL(nextPageUri, TWILIO_API_ORIGIN).toString();
}

function hubApiUrl(hubUrl: string, pathname: string): URL {
  const base = new URL(hubUrl);
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
    throw new Error("HUB_URL must use HTTPS unless it points to localhost");
  }
  return new URL(pathname, base.origin);
}

export interface HubCallsUrlOptions {
  needsTranscript?: boolean;
  provider?: string;
  limit?: number;
  since?: string;
  cursor?: string;
  providerCallId?: string;
}

export function buildHubCallsUrl(hubUrl: string, options: HubCallsUrlOptions = {}): string {
  const url = hubApiUrl(hubUrl, "/api/internal/mcp/v1/calls");
  if (options.needsTranscript) url.searchParams.set("needsTranscript", "1");
  if (options.provider) url.searchParams.set("provider", options.provider);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  if (options.since) url.searchParams.set("since", options.since);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.providerCallId) url.searchParams.set("providerCallId", options.providerCallId);
  return url.toString();
}

export function buildHubRecordingUrl(hubUrl: string, id: string): string {
  return hubApiUrl(
    hubUrl,
    `/api/internal/mcp/v1/calls/${encodeURIComponent(id)}/recording`,
  ).toString();
}

export function buildHubCallPatchUrl(hubUrl: string, id: string): string {
  return hubApiUrl(hubUrl, `/api/internal/mcp/v1/calls/${encodeURIComponent(id)}`).toString();
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) {
    return "—";
  }
  const digits = phone.replace(/\D/g, "");
  return digits.length === 0 ? "—" : `••${digits.slice(-2)}`;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv<T extends Record<keyof T, string>>(
  headers: readonly (keyof T & string)[],
  rows: T[],
): string {
  const lines = [headers.map(quoteCsv).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => quoteCsv(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function parseCsvCells(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      if (cell.length > 0) {
        throw new Error("Malformed CSV: quote inside unquoted field");
      }
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw new Error("Malformed CSV: unterminated quoted field");
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function parseCsv<T extends Record<keyof T, string>>(
  csv: string,
  headers: readonly (keyof T & string)[],
): T[] {
  const rows = parseCsvCells(csv);
  const actualHeaders = rows.shift();
  if (!actualHeaders || actualHeaders.join("\u0000") !== headers.join("\u0000")) {
    throw new Error(`CSV headers must be: ${headers.join(",")}`);
  }
  return rows
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((row, rowIndex): T => {
      if (row.length !== headers.length) {
        throw new Error(`CSV row ${rowIndex + 2} has ${row.length} fields; expected ${headers.length}`);
      }
      const result: Partial<T> = {};
      headers.forEach((header, columnIndex) => {
        result[header] = row[columnIndex] as T[typeof header];
      });
      return result as T;
    });
}

export function formatMonth(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid startedAt date: ${startedAt}`);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function renderMarkdown(input: MarkdownInput): string {
  if (!/^call-\d{3,}$/.test(input.id)) {
    throw new Error(`Invalid neutral call id: ${input.id}`);
  }
  if (/\b(?:CA|RE)[0-9A-Za-z]{8,}\b/.test(input.transcript)) {
    throw new Error("Transcript still contains a Twilio SID");
  }
  const durationMinutes = (input.durationSec / 60).toFixed(1);
  return [
    `# ${input.id}`,
    "",
    `Month: ${formatMonth(input.startedAt)}`,
    `Duration: ${durationMinutes} minutes`,
    "",
    input.transcript.trim(),
    "",
  ].join("\n");
}

function parseOptionTokens(tokens: string[]): Map<string, string | true> {
  const options = new Map<string, string | true>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token ?? ""}`);
    }
    if (options.has(token)) {
      throw new Error(`Duplicate option: ${token}`);
    }
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options.set(token, true);
    } else {
      options.set(token, next);
      index += 1;
    }
  }
  return options;
}

function stringOption(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  if (value === true) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function requiredOption(options: Map<string, string | true>, name: string): string {
  const value = stringOption(options, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function numericOption(
  options: Map<string, string | true>,
  name: string,
  defaultValue?: number,
): number | undefined {
  const value = stringOption(options, name);
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (name === "--limit" && !Number.isInteger(parsed))) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function rejectUnknown(options: Map<string, string | true>, allowed: readonly string[]): void {
  for (const name of options.keys()) {
    if (!allowed.includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
  }
}

export function parseArgs(argv: string[]): CliOptions {
  const [command, ...tokens] = argv;
  if (command === "list") {
    if (tokens.length > 0) {
      throw new Error("list does not accept options");
    }
    return { command: "list" };
  }

  const options = parseOptionTokens(tokens);
  if (command === "run") {
    const allowed = [
      "--out",
      "--limit",
      "--since",
      "--min-duration",
      "--swap-channels",
      "--whisper-cmd",
      "--model",
      "--force",
      "--source",
      "--no-writeback",
    ] as const;
    rejectUnknown(options, allowed);
    const since = stringOption(options, "--since");
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      throw new Error("--since must use YYYY-MM-DD");
    }
    const limit = numericOption(options, "--limit");
    const source = stringOption(options, "--source") ?? "twilio";
    if (source !== "twilio" && source !== "hub") {
      throw new Error("--source must be twilio or hub");
    }
    return {
      command,
      out: requiredOption(options, "--out"),
      source,
      ...(limit === undefined ? {} : { limit }),
      ...(since === undefined ? {} : { since }),
      minDuration: numericOption(options, "--min-duration", 20) ?? 20,
      swapChannels: options.get("--swap-channels") === true,
      whisperCmd: stringOption(options, "--whisper-cmd") ?? DEFAULT_WHISPER_COMMAND,
      model: stringOption(options, "--model") ?? DEFAULT_WHISPER_MODEL,
      force: options.get("--force") === true,
      noWriteback: options.get("--no-writeback") === true,
    };
  }

  if (command === "push") {
    rejectUnknown(options, ["--out"]);
    return { command, out: requiredOption(options, "--out") };
  }

  if (command === "anonymize") {
    const allowed = [
      "--out",
      "--drive-dir",
      "--names-csv",
      "--closer-names",
      "--entities-cmd",
    ] as const;
    rejectUnknown(options, allowed);
    const namesCsv = stringOption(options, "--names-csv");
    const entitiesCmd = stringOption(options, "--entities-cmd");
    const closerNames = (stringOption(options, "--closer-names") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    return {
      command,
      out: requiredOption(options, "--out"),
      driveDir: requiredOption(options, "--drive-dir"),
      ...(namesCsv === undefined ? {} : { namesCsv }),
      closerNames,
      ...(entitiesCmd === undefined ? {} : { entitiesCmd }),
    };
  }

  throw new Error("Usage: call-transcripts.ts <list|run|push|anonymize> [options]");
}
