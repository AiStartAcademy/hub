import { promises as fs } from "node:fs";
import path from "node:path";

import {
  FFMPEG_TIMEOUT_MS,
  FFPROBE_TIMEOUT_MS,
  runCommand,
  TRANSCRIBE_TIMEOUT_MS,
} from "../dub-audio/backends";
import { parseWhisperJson, type Segment } from "../dub-audio/core";
import { wordSpan, type ChannelSegment } from "./core";

export interface WhisperOptions {
  commandLine: string;
  model: string;
}

interface CommandParts {
  command: string;
  prefixArgs: string[];
}

function commandParts(commandLine: string): CommandParts {
  const parts = commandLine.trim().split(/\s+/).filter(Boolean);
  const [command, ...prefixArgs] = parts;
  if (!command) {
    throw new Error("Whisper command cannot be empty");
  }
  return { command, prefixArgs };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function preflightTranscription(options: WhisperOptions): Promise<void> {
  try {
    await runCommand("ffmpeg", ["-version"], { timeoutMs: FFPROBE_TIMEOUT_MS });
    await runCommand("ffprobe", ["-version"], { timeoutMs: FFPROBE_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`ffmpeg/ffprobe preflight failed. Install both with: brew install ffmpeg\n${errorMessage(error)}`);
  }

  const whisper = commandParts(options.commandLine);
  try {
    await runCommand(whisper.command, [...whisper.prefixArgs, "--help"], {
      timeoutMs: FFPROBE_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(
      `Whisper preflight failed for ${JSON.stringify(options.commandLine)}. Install uv/uvx and mlx-whisper, or pass --whisper-cmd.\n${errorMessage(error)}`,
    );
  }
}

export async function probeChannelCount(audioPath: string): Promise<number> {
  const result = await runCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=channels",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ],
    { timeoutMs: FFPROBE_TIMEOUT_MS },
  );
  const channels = Number(result.stdout.trim());
  if (!Number.isInteger(channels) || channels < 1 || channels > 2) {
    throw new Error(`Expected mono or stereo audio, but ffprobe reported ${JSON.stringify(result.stdout.trim())}`);
  }
  return channels;
}

export async function splitChannels(
  audioPath: string,
  workDirectory: string,
  channelCount: number,
): Promise<string[]> {
  if (channelCount !== 1 && channelCount !== 2) {
    throw new Error(`Cannot split unsupported channel count: ${channelCount}`);
  }
  await fs.mkdir(workDirectory, { recursive: true });
  const outputPaths: string[] = [];

  for (let channel = 0; channel < channelCount; channel += 1) {
    const outputPath = path.join(workDirectory, `channel-${channel}.wav`);
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        audioPath,
        "-af",
        `pan=mono|c0=c${channel}`,
        "-ar",
        "16000",
        "-ac",
        "1",
        outputPath,
      ],
      { timeoutMs: FFMPEG_TIMEOUT_MS },
    );
    outputPaths.push(outputPath);
  }
  return outputPaths;
}

async function findWhisperJson(directory: string): Promise<string> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(directory, entry.name));
  if (jsonFiles.length !== 1) {
    throw new Error(
      `Whisper must produce exactly one JSON file in ${directory}; found ${jsonFiles.length}`,
    );
  }
  return jsonFiles[0] as string;
}

function noSpeechProbability(raw: unknown, index: number): number | undefined {
  if (raw === null || typeof raw !== "object" || !("segments" in raw)) {
    return undefined;
  }
  const segments = (raw as { segments: unknown }).segments;
  if (!Array.isArray(segments)) {
    return undefined;
  }
  const item = segments[index];
  if (item === null || typeof item !== "object" || !("no_speech_prob" in item)) {
    return undefined;
  }
  const probability = (item as { no_speech_prob: unknown }).no_speech_prob;
  if (typeof probability !== "number" || !Number.isFinite(probability)) {
    throw new Error(`Invalid Whisper JSON: segments[${index}].no_speech_prob must be a finite number`);
  }
  return probability;
}

export async function transcribeChannel(
  audioPath: string,
  outputDirectory: string,
  channel: number,
  options: WhisperOptions,
): Promise<ChannelSegment[]> {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  const whisper = commandParts(options.commandLine);
  await runCommand(
    whisper.command,
    [
      ...whisper.prefixArgs,
      audioPath,
      "--model",
      options.model,
      "--output-format",
      "json",
      "--output-dir",
      outputDirectory,
      "--condition-on-previous-text",
      "False",
      "--word-timestamps",
      "True",
    ],
    { timeoutMs: TRANSCRIBE_TIMEOUT_MS },
  );

  const jsonPath = await findWhisperJson(outputDirectory);
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse Whisper JSON at ${jsonPath}: ${errorMessage(error)}`);
  }
  return parseWhisperJson(raw).map(
    (segment: Segment, index: number): ChannelSegment => ({
      ...segment,
      ...wordSpan((raw as { segments: unknown[] }).segments[index]),
      channel,
      noSpeechProb: noSpeechProbability(raw, index),
    }),
  );
}
