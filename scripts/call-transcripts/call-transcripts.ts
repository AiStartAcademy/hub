#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  assignNeutralIds,
  filterHallucinations,
  findLeaks,
  mergeChannelSegments,
  parseArgs,
  parseCsv,
  parseEntitiesJson,
  redactEntities,
  redactText,
  renderMarkdown,
  renderTranscript,
  serializeCsv,
  type CallIdentity,
  type IndexRow,
  type MappingRow,
  type TranscriptSegment,
} from "./core";
import { preflightTranscription, probeChannelCount, splitChannels, transcribeChannel } from "./transcribe";
import { HubClient, type HubCall } from "./hub";
import { TwilioClient, type TwilioCallWithParent, type TwilioRecording } from "./twilio";

const INDEX_HEADERS = ["callSid", "recordingSid", "dialedNumber", "startedAt", "durationSec", "direction", "rawJsonPath"] as const;
const MAPPING_HEADERS = ["id", "callSid", "recordingSid", "dialedNumber"] as const;
const CALL_NAME_HEADERS = ["callSid", "name"] as const;
const ENTITY_TIMEOUT_MS = 60_000;

interface RawTranscript {
  segments: TranscriptSegment[];
  durationSec: number;
  startedAt: string;
  dialedNumber: string;
  recordingSid: string;
  callSid: string;
  direction: string;
}

interface NameRow {
  phone: string;
  name: string;
}

interface CallNameRow {
  callSid: string;
  name: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readCsvIfPresent<T extends Record<keyof T, string>>(
  filePath: string,
  headers: readonly (keyof T & string)[],
): Promise<T[]> {
  try {
    return parseCsv<T>(await fs.readFile(filePath, "utf8"), headers);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function credentials(): { accountSid: string; authToken: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID and/or TWILIO_AUTH_TOKEN environment variables");
  }
  return { accountSid, authToken };
}

function hubCredentials(): { hubUrl: string; token: string } {
  const hubUrl = process.env.HUB_URL;
  const token = process.env.HUB_MCP_TOKEN;
  if (!hubUrl || !token) {
    throw new Error("Missing HUB_URL and/or HUB_MCP_TOKEN environment variables");
  }
  return { hubUrl, token };
}

function callMetadata(result: TwilioCallWithParent): { dialedNumber: string; direction: string; startedAt: string } {
  const context = result.parent ?? result.call;
  return {
    dialedNumber: result.call.to,
    direction: context.direction,
    startedAt: context.startTime,
  };
}

async function list(client: TwilioClient): Promise<void> {
  const recordings = await client.listRecordings();
  console.log("RecordingSid\tCallSid\tdate\tduration\tchannels");
  for (const recording of recordings) {
    console.log(`${recording.sid}\t${recording.callSid}\t${recording.dateCreated}\t${recording.durationSec}\t${recording.channels}`);
  }
}

function selectedRecordings(recordings: TwilioRecording[], since: string | undefined, minimum: number, limit: number | undefined): TwilioRecording[] {
  const sinceTime = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(`${since}T00:00:00Z`);
  const selected = recordings
    .filter((recording) => recording.durationSec >= minimum && Date.parse(recording.dateCreated) >= sinceTime)
    .sort((left, right) => Date.parse(left.dateCreated) - Date.parse(right.dateCreated));
  return limit === undefined ? selected : selected.slice(0, limit);
}

async function writeRaw(out: string, raw: RawTranscript): Promise<IndexRow> {
  const rawDir = path.join(out, "raw");
  await fs.mkdir(rawDir, { recursive: true });
  const jsonPath = path.join(rawDir, `${raw.callSid}.json`);
  await fs.writeFile(path.join(rawDir, `${raw.callSid}.txt`), `${renderTranscript(raw.segments)}\n`, "utf8");
  await fs.writeFile(jsonPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return {
    callSid: raw.callSid,
    recordingSid: raw.recordingSid,
    dialedNumber: raw.dialedNumber,
    startedAt: raw.startedAt,
    durationSec: String(raw.durationSec),
    direction: raw.direction,
    rawJsonPath: path.relative(out, jsonPath),
  };
}

async function transcribeAudio(
  audioPath: string,
  workDir: string,
  options: Extract<ReturnType<typeof parseArgs>, { command: "run" }>,
): Promise<TranscriptSegment[]> {
  const channelCount = await probeChannelCount(audioPath);
  const channels = await splitChannels(audioPath, workDir, channelCount);
  const channel0 = filterHallucinations(
    await transcribeChannel(channels[0] as string, path.join(workDir, "whisper-0"), 0, {
      commandLine: options.whisperCmd,
      model: options.model,
    }),
  );
  const channel1 = channelCount === 2
    ? filterHallucinations(
        await transcribeChannel(channels[1] as string, path.join(workDir, "whisper-1"), 1, {
          commandLine: options.whisperCmd,
          model: options.model,
        }),
      )
    : undefined;
  return mergeChannelSegments(channel0, channel1, options.swapChannels);
}

async function runTwilioTranscription(client: TwilioClient, options: Extract<ReturnType<typeof parseArgs>, { command: "run" }>): Promise<void> {
  await preflightTranscription({ commandLine: options.whisperCmd, model: options.model });
  await fs.mkdir(path.join(options.out, "audio"), { recursive: true });
  const indexPath = path.join(options.out, "index.csv");
  const index = await readCsvIfPresent<IndexRow>(indexPath, INDEX_HEADERS);
  const byCall = new Map(index.map((row) => [row.callSid, row]));
  const recordings = selectedRecordings(await client.listRecordings(), options.since, options.minDuration, options.limit);

  for (const recording of recordings) {
    const jsonPath = path.join(options.out, "raw", `${recording.callSid}.json`);
    if (!options.force) {
      try {
        await fs.access(jsonPath);
        console.log(`skip ${recording.callSid}`);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    console.log(`transcribe ${recording.callSid}`);
    const audioPath = path.join(options.out, "audio", `${recording.sid}.wav`);
    await client.downloadRecording(recording.sid, audioPath);
    const call = callMetadata(await client.getCall(recording.callSid));
    const workDir = path.join(options.out, ".work", recording.sid);
    const raw: RawTranscript = {
      segments: await transcribeAudio(audioPath, workDir, options),
      durationSec: recording.durationSec,
      startedAt: call.startedAt,
      dialedNumber: call.dialedNumber,
      recordingSid: recording.sid,
      callSid: recording.callSid,
      direction: call.direction,
    };
    byCall.set(raw.callSid, await writeRaw(options.out, raw));
  }
  const rows = [...byCall.values()].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  await fs.writeFile(indexPath, serializeCsv(INDEX_HEADERS, rows), "utf8");
}

function completeHubCall(call: HubCall): {
  id: string;
  callSid: string;
  recordingSid: string;
  durationSec: number;
  startedAt: string;
  direction: string;
  contactName: string;
} {
  if (!call.providerCallId) throw new Error(`Hub call ${call.id} has no providerCallId`);
  if (!call.recordingSid) throw new Error(`Hub call ${call.id} has no Twilio recording SID`);
  if (call.durationSec === null) throw new Error(`Hub call ${call.id} has no duration`);
  if (!call.startedAt || Number.isNaN(Date.parse(call.startedAt))) {
    throw new Error(`Hub call ${call.id} has no valid start time`);
  }
  return {
    id: call.id,
    callSid: call.providerCallId,
    recordingSid: call.recordingSid,
    durationSec: call.durationSec,
    startedAt: call.startedAt,
    direction: call.direction,
    contactName: call.contactName,
  };
}

async function writeCallNames(out: string, calls: ReturnType<typeof completeHubCall>[]): Promise<void> {
  const filePath = path.join(out, "call-names.csv");
  const existing = await readCsvIfPresent<CallNameRow>(filePath, CALL_NAME_HEADERS);
  const byCallSid = new Map(existing.map((row) => [row.callSid, row]));
  for (const call of calls) byCallSid.set(call.callSid, { callSid: call.callSid, name: call.contactName });
  const rows = [...byCallSid.values()].sort((left, right) => left.callSid.localeCompare(right.callSid));
  await fs.writeFile(filePath, serializeCsv(CALL_NAME_HEADERS, rows), "utf8");
}

async function runHubTranscription(
  client: HubClient,
  options: Extract<ReturnType<typeof parseArgs>, { command: "run" }>,
): Promise<void> {
  await preflightTranscription({ commandLine: options.whisperCmd, model: options.model });
  await fs.mkdir(path.join(options.out, "audio"), { recursive: true });
  const indexPath = path.join(options.out, "index.csv");
  const index = await readCsvIfPresent<IndexRow>(indexPath, INDEX_HEADERS);
  const byCall = new Map(index.map((row) => [row.callSid, row]));
  const listed = await client.listCalls({
    needsTranscript: true,
    provider: "twilio",
    limit: 200,
    ...(options.since ? { since: options.since } : {}),
  });
  const eligible = listed
    .filter((call) => call.durationSec !== null && call.durationSec >= options.minDuration)
    .sort((left, right) => Date.parse(left.startedAt ?? "") - Date.parse(right.startedAt ?? ""));
  const selected = (options.limit === undefined ? eligible : eligible.slice(0, options.limit)).map(completeHubCall);
  await writeCallNames(options.out, selected);

  for (const call of selected) {
    const jsonPath = path.join(options.out, "raw", `${call.callSid}.json`);
    if (!options.force) {
      try {
        const existing = rawTranscript(JSON.parse(await fs.readFile(jsonPath, "utf8")), jsonPath);
        if (!options.noWriteback) {
          await client.patchTranscript(call.id, renderTranscript(existing.segments));
          console.log(`writeback ${call.callSid}`);
        } else {
          console.log(`skip ${call.callSid}`);
        }
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    console.log(`transcribe ${call.callSid}`);
    const audioPath = path.join(options.out, "audio", `${call.recordingSid}.wav`);
    await client.downloadRecording(call.id, audioPath);
    const raw: RawTranscript = {
      segments: await transcribeAudio(
        audioPath,
        path.join(options.out, ".work", call.recordingSid),
        options,
      ),
      durationSec: call.durationSec,
      startedAt: call.startedAt,
      dialedNumber: "",
      recordingSid: call.recordingSid,
      callSid: call.callSid,
      direction: call.direction,
    };
    byCall.set(raw.callSid, await writeRaw(options.out, raw));
    if (!options.noWriteback) await client.patchTranscript(call.id, renderTranscript(raw.segments));
  }
  const rows = [...byCall.values()].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  await fs.writeFile(indexPath, serializeCsv(INDEX_HEADERS, rows), "utf8");
}

function rawTranscript(value: unknown, filePath: string): RawTranscript {
  if (value === null || typeof value !== "object") throw new Error(`Invalid raw transcript: ${filePath}`);
  const raw = value as Partial<RawTranscript>;
  if (!Array.isArray(raw.segments) || typeof raw.durationSec !== "number" || typeof raw.startedAt !== "string" ||
      typeof raw.dialedNumber !== "string" || typeof raw.recordingSid !== "string" || typeof raw.callSid !== "string" || typeof raw.direction !== "string") {
    throw new Error(`Invalid raw transcript shape: ${filePath}`);
  }
  return raw as RawTranscript;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function entityOutput(commandLine: string, input: string): Promise<string> {
  const parts = commandLine.trim().split(/\s+/).filter(Boolean);
  const command = parts.shift();
  if (!command) throw new Error("--entities-cmd cannot be empty");
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, parts, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), ENTITY_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Entity command exited ${code ?? "by signal"}: ${stderr.trim() || "no stderr"}`));
    });
    child.stdin.end(input);
  });
}

async function anonymize(options: Extract<ReturnType<typeof parseArgs>, { command: "anonymize" }>): Promise<void> {
  const index = await readCsvIfPresent<IndexRow>(path.join(options.out, "index.csv"), INDEX_HEADERS);
  const mappingPath = path.join(options.out, "mapping.csv");
  const existing = await readCsvIfPresent<MappingRow>(mappingPath, MAPPING_HEADERS);
  const identities: CallIdentity[] = index.map(({ callSid, recordingSid, dialedNumber, startedAt }) => ({ callSid, recordingSid, dialedNumber, startedAt }));
  const mapping = assignNeutralIds(existing, identities);
  await fs.writeFile(mappingPath, serializeCsv(MAPPING_HEADERS, mapping), "utf8");
  const names = options.namesCsv
    ? parseCsv<NameRow>(await fs.readFile(options.namesCsv, "utf8"), ["phone", "name"] as const)
    : [];
  const namesByPhone = new Map(names.map((row) => [normalizePhone(row.phone), row.name]));
  const callNames = await readCsvIfPresent<CallNameRow>(path.join(options.out, "call-names.csv"), CALL_NAME_HEADERS);
  const namesByCallSid = new Map(callNames.map((row) => [row.callSid, row.name]));
  const transcriptDir = path.join(options.driveDir, "transcripts");
  await fs.mkdir(transcriptDir, { recursive: true });
  let failures = 0;

  for (const row of index) {
    const neutral = mapping.find((item) => item.callSid === row.callSid);
    if (!neutral) throw new Error(`No mapping for ${row.callSid}`);
    try {
      const filePath = path.resolve(options.out, row.rawJsonPath);
      const raw = rawTranscript(JSON.parse(await fs.readFile(filePath, "utf8")), filePath);
      const leadName = namesByCallSid.get(raw.callSid) ?? namesByPhone.get(normalizePhone(raw.dialedNumber));
      const knownNames = [...(leadName ? [leadName] : []), ...options.closerNames];
      let transcript = redactText(renderTranscript(raw.segments), {
        leadNames: leadName ? [leadName] : [],
        closerNames: options.closerNames,
      });
      if (options.entitiesCmd) transcript = redactEntities(transcript, parseEntitiesJson(await entityOutput(options.entitiesCmd, transcript)));
      const leaks = findLeaks(transcript, knownNames);
      if (leaks.length > 0) throw new Error(`leak check failed: ${leaks.join(", ")}`);
      const markdown = renderMarkdown({ id: neutral.id, startedAt: raw.startedAt, durationSec: raw.durationSec, transcript });
      await fs.writeFile(path.join(transcriptDir, `${neutral.id}.md`), markdown, "utf8");
      console.log(`wrote ${neutral.id}.md`);
    } catch (error) {
      failures += 1;
      console.error(`${neutral.id} failed: ${message(error)}`);
    }
  }
  if (failures > 0) throw new Error(`${failures} call(s) failed anonymization`);
}

async function pushTranscripts(client: HubClient, out: string): Promise<void> {
  const index = await readCsvIfPresent<IndexRow>(path.join(out, "index.csv"), INDEX_HEADERS);
  if (index.length === 0) throw new Error(`No transcript rows found in ${path.join(out, "index.csv")}`);
  for (const row of index) {
    const filePath = path.resolve(out, row.rawJsonPath);
    const raw = rawTranscript(JSON.parse(await fs.readFile(filePath, "utf8")), filePath);
    const call = await client.findByProviderCallId(raw.callSid);
    await client.patchTranscript(call.id, renderTranscript(raw.segments), true);
    console.log(`pushed ${raw.callSid}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "anonymize") {
    await anonymize(options);
    return;
  }
  if (options.command === "push") {
    const { hubUrl, token } = hubCredentials();
    await pushTranscripts(new HubClient(hubUrl, token), options.out);
    return;
  }
  if (options.command === "run" && options.source === "hub") {
    const { hubUrl, token } = hubCredentials();
    await runHubTranscription(new HubClient(hubUrl, token), options);
    return;
  }
  const { accountSid, authToken } = credentials();
  const client = new TwilioClient(accountSid, authToken);
  if (options.command === "list") await list(client);
  else await runTwilioTranscription(client, options);
}

main().catch((error: unknown) => {
  console.error(message(error));
  process.exitCode = 1;
});
