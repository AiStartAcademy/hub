import { accessSync, constants as fsConstants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  createBackends,
  DEFAULT_TTS_BACKEND,
  FFMPEG_TIMEOUT_MS,
  FFPROBE_TIMEOUT_MS,
  probeDurationSec,
  runCommand,
  selectBackend,
  TRANSCRIBE_TIMEOUT_MS,
  type TtsBackend,
} from "./backends";
import {
  formatTimestamp,
  parseSrt,
  planTimeline,
  type PlacedSegment,
  type Segment,
} from "./core";

const DEFAULT_OUT_DIR = "./dub-out";
const DEFAULT_TRANSLATE_MODE = "whisper-translate";
const DEFAULT_FORMAT = "wav";
const DEFAULT_REF_START = 0;
const DEFAULT_REF_DURATION = 30;
const DEFAULT_PYTHON = "python3";
const DEFAULT_WHISPER_MODEL = "mlx-community/whisper-large-v3-mlx";
const WORK_DIR_NAME = "work";
const TRANSCRIBE_DIR_NAME = "transcribe";

const TRANSLATE_MODES = ["whisper-translate", "transcribe-then-translate"] as const;
const OUTPUT_FORMATS = ["wav", "mp3"] as const;

type TranslateMode = (typeof TRANSLATE_MODES)[number];
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

interface CliOptions {
  help: boolean;
  inputPath: string;
  outDir: string;
  ttsName: string;
  translateMode: TranslateMode;
  format: OutputFormat;
  refStart: number;
  refDuration: number;
  whisperModel: string;
  pythonPath: string;
  openVoiceRoot?: string;
  remux: boolean;
  keepIntermediates: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  bun scripts/dub-audio/dub-audio.ts --input <media-file> [options]",
    "",
    "Options:",
    "  --input <path>                  Input media file (required)",
    `  --out-dir <path>                Output directory (default: ${DEFAULT_OUT_DIR})`,
    `  --tts <name>                    TTS backend (default: ${DEFAULT_TTS_BACKEND})`,
    `  --translate-mode <mode>         ${TRANSLATE_MODES.join(" | ")} (default: ${DEFAULT_TRANSLATE_MODE})`,
    `  --format <format>               ${OUTPUT_FORMATS.join(" | ")} (default: ${DEFAULT_FORMAT})`,
    `  --ref-start <seconds>           Reference clip start offset (default: ${DEFAULT_REF_START})`,
    `  --ref-duration <seconds>        Reference clip duration (default: ${DEFAULT_REF_DURATION})`,
    `  --whisper-model <name>          Whisper model (default: ${DEFAULT_WHISPER_MODEL})`,
    `  --python <path>                 Python interpreter (default: ${DEFAULT_PYTHON})`,
    "  --openvoice-root <path>         OpenVoice checkout root (required for openvoice backend)",
    "  --remux                         Remux dubbed audio back into an MP4",
    "  --keep-intermediates            Keep work/ intermediates",
    "  --help                          Show this help and exit",
  ].join("\n");
}

function assertEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  flagName: string,
): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }

  throw new Error(`${flagName} must be one of: ${allowed.join(", ")}`);
}

function parseNonNegativeNumber(rawValue: string, flagName: string): number {
  const parsedValue: number = Number(rawValue);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${flagName} must be a finite, non-negative number`);
  }

  return parsedValue;
}

function parsePositiveNumber(rawValue: string, flagName: string): number {
  const parsedValue: number = parseNonNegativeNumber(rawValue, flagName);

  if (parsedValue <= 0) {
    throw new Error(`${flagName} must be greater than 0`);
  }

  return parsedValue;
}

function parseCliOptions(argv: string[]): CliOptions {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      input: { type: "string" },
      "out-dir": { type: "string" },
      tts: { type: "string" },
      "translate-mode": { type: "string" },
      format: { type: "string" },
      "ref-start": { type: "string" },
      "ref-duration": { type: "string" },
      "whisper-model": { type: "string" },
      python: { type: "string" },
      "openvoice-root": { type: "string" },
      remux: { type: "boolean" },
      "keep-intermediates": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const help: boolean = parsed.values.help ?? false;

  if (help) {
    return {
      help: true,
      inputPath: "",
      outDir: DEFAULT_OUT_DIR,
      ttsName: DEFAULT_TTS_BACKEND,
      translateMode: DEFAULT_TRANSLATE_MODE,
      format: DEFAULT_FORMAT,
      refStart: DEFAULT_REF_START,
      refDuration: DEFAULT_REF_DURATION,
      whisperModel: DEFAULT_WHISPER_MODEL,
      pythonPath: DEFAULT_PYTHON,
      openVoiceRoot: undefined,
      remux: parsed.values.remux ?? false,
      keepIntermediates: parsed.values["keep-intermediates"] ?? false,
    };
  }

  const inputValue: string | undefined = parsed.values.input;

  if (!inputValue) {
    throw new Error("--input is required");
  }

  return {
    help: false,
    inputPath: inputValue,
    outDir: parsed.values["out-dir"] ?? DEFAULT_OUT_DIR,
    ttsName: parsed.values.tts ?? DEFAULT_TTS_BACKEND,
    translateMode: assertEnumValue(
      parsed.values["translate-mode"] ?? DEFAULT_TRANSLATE_MODE,
      TRANSLATE_MODES,
      "--translate-mode",
    ),
    format: assertEnumValue(parsed.values.format ?? DEFAULT_FORMAT, OUTPUT_FORMATS, "--format"),
    refStart: parseNonNegativeNumber(
      parsed.values["ref-start"] ?? String(DEFAULT_REF_START),
      "--ref-start",
    ),
    refDuration: parsePositiveNumber(
      parsed.values["ref-duration"] ?? String(DEFAULT_REF_DURATION),
      "--ref-duration",
    ),
    whisperModel: parsed.values["whisper-model"] ?? DEFAULT_WHISPER_MODEL,
    pythonPath: parsed.values.python ?? DEFAULT_PYTHON,
    openVoiceRoot: parsed.values["openvoice-root"],
    remux: parsed.values.remux ?? false,
    keepIntermediates: parsed.values["keep-intermediates"] ?? false,
  };
}

function assertReadableInputFile(inputPath: string): void {
  accessSync(inputPath, fsConstants.R_OK);
}

async function assertInputIsFile(inputPath: string): Promise<void> {
  const fileStat = await fs.stat(inputPath);

  if (!fileStat.isFile()) {
    throw new Error(`Input path is not a file: ${inputPath}`);
  }
}

async function locateSingleSrtFile(outputDir: string): Promise<string> {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const matches: string[] = entries
    .filter((entry: import("node:fs").Dirent): boolean => entry.isFile())
    .map((entry: import("node:fs").Dirent): string => entry.name)
    .filter((fileName: string): boolean => fileName.toLowerCase().endsWith(".srt"))
    .map((fileName: string): string => path.join(outputDir, fileName));

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new Error(`mlx_whisper did not produce an .srt file in ${outputDir}`);
  }

  throw new Error(
    `mlx_whisper produced multiple .srt files in ${outputDir}: ${matches.map((file) => path.basename(file)).join(", ")}`,
  );
}

async function runPreflight(backend: TtsBackend): Promise<void> {
  try {
    await runCommand("ffmpeg", ["-version"], { timeoutMs: FFMPEG_TIMEOUT_MS });
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    throw new Error(`ffmpeg preflight failed. Install it with: brew install ffmpeg\n${message}`);
  }

  try {
    await runCommand("ffprobe", ["-version"], { timeoutMs: FFPROBE_TIMEOUT_MS });
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    throw new Error(`ffprobe preflight failed. Install it with: brew install ffmpeg\n${message}`);
  }

  await backend.preflight();
}

async function transcribeToSegments(
  sourceWavPath: string,
  transcribeDirPath: string,
  whisperModel: string,
  translateMode: TranslateMode,
): Promise<Segment[]> {
  await fs.rm(transcribeDirPath, { recursive: true, force: true });
  await fs.mkdir(transcribeDirPath, { recursive: true });

  const whisperArgs: string[] = [
    "--model",
    whisperModel,
    "--output-format",
    "srt",
    "--output-dir",
    transcribeDirPath,
  ];

  if (translateMode === "whisper-translate") {
    whisperArgs.push("--task", "translate");
  } else {
    whisperArgs.push("--task", "transcribe", "--language", "ru");
  }

  whisperArgs.push(sourceWavPath);

  await runCommand("mlx_whisper", whisperArgs, { timeoutMs: TRANSCRIBE_TIMEOUT_MS });

  const srtPath: string = await locateSingleSrtFile(transcribeDirPath);
  const srtContents: string = await fs.readFile(srtPath, "utf8");

  return parseSrt(srtContents);
}

function translateSegments(segments: Segment[], translateMode: TranslateMode): Segment[] {
  if (translateMode === "whisper-translate") {
    return segments;
  }

  throw new Error(
    [
      "transcribe-then-translate was requested, but no machine-translation or LLM translation stage is wired in.",
      "Add a dedicated MT/LLM pass before TTS. Russian transcript text will NOT be passed through to the English-only TTS backend.",
    ].join(" "),
  );
}

function makeSegmentPath(workDirPath: string, segmentIndex: number): string {
  return path.join(workDirPath, `seg-${String(segmentIndex).padStart(3, "0")}.wav`);
}

async function synthesizeSegments(
  backend: TtsBackend,
  segments: Segment[],
  referenceAudioPath: string,
  workDirPath: string,
): Promise<number[]> {
  const durationsSec: number[] = [];

  for (const segment of segments) {
    const outputPath: string = makeSegmentPath(workDirPath, segment.index);

    if (segment.text.trim() === "") {
      process.stderr.write(
        `Skipping whitespace-only segment ${segment.index} at ${formatTimestamp(segment.startSec)}.\n`,
      );
      durationsSec.push(0);
      continue;
    }

    await backend.synthesize({
      text: segment.text,
      referenceAudioPath,
      outputPath,
      language: "en",
    });

    durationsSec.push(await probeDurationSec(outputPath));
  }

  return durationsSec;
}

function logOverruns(overruns: PlacedSegment[]): void {
  for (const overrun of overruns) {
    process.stderr.write(
      [
        `Warning: segment ${overrun.index} at ${formatTimestamp(overrun.startSec)} overruns its slot.`,
        `slot=${overrun.slotSec.toFixed(3)}s`,
        `synth=${overrun.synthSec.toFixed(3)}s`,
        `overrun=${overrun.overrunSec.toFixed(3)}s`,
      ].join(" ") + "\n",
    );
  }
}

async function renderSilence(outputPath: string, durationSec: number): Promise<void> {
  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=mono:sample_rate=16000",
      "-t",
      String(durationSec),
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );
}

async function assembleDubbedWav(
  placements: PlacedSegment[],
  workDirPath: string,
  outputPath: string,
  totalDurationSec: number,
): Promise<void> {
  const audiblePlacements: PlacedSegment[] = placements.filter(
    (placement: PlacedSegment): boolean => placement.synthSec > 0,
  );

  if (audiblePlacements.length === 0) {
    process.stderr.write(
      `Warning: no subtitle segments were produced. Emitting ${totalDurationSec.toFixed(3)}s of silence.\n`,
    );
    await renderSilence(outputPath, totalDurationSec);
    return;
  }

  const ffmpegArgs: string[] = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=mono:sample_rate=16000",
  ];

  const filterLines: string[] = [`[0:a]atrim=duration=${totalDurationSec}[bed]`];

  audiblePlacements.forEach((placement: PlacedSegment, segmentOffset: number) => {
    ffmpegArgs.push("-i", makeSegmentPath(workDirPath, placement.index));

    const delayMs: number = Math.max(0, Math.round(placement.startSec * 1000));
    filterLines.push(`[${segmentOffset + 1}:a]adelay=${delayMs}|${delayMs}[a${segmentOffset}]`);
  });

  const mixInputs: string = ["[bed]", ...audiblePlacements.map((_, index: number) => `[a${index}]`)].join("");
  filterLines.push(
    `${mixInputs}amix=inputs=${audiblePlacements.length + 1}:normalize=0:dropout_transition=0[mix]`,
  );

  ffmpegArgs.push(
    "-filter_complex",
    filterLines.join(";"),
    "-map",
    "[mix]",
    "-c:a",
    "pcm_s16le",
    outputPath,
  );

  await runCommand("ffmpeg", ffmpegArgs, { timeoutMs: FFMPEG_TIMEOUT_MS });
}

async function maybeEncodeMp3(
  requestedFormat: OutputFormat,
  outDirPath: string,
  dubbedWavPath: string,
): Promise<string> {
  if (requestedFormat === "wav") {
    return dubbedWavPath;
  }

  const mp3Path: string = path.join(outDirPath, "dubbed.mp3");

  await runCommand(
    "ffmpeg",
    ["-y", "-i", dubbedWavPath, "-c:a", "libmp3lame", mp3Path],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );

  return mp3Path;
}

async function maybeRemux(
  remuxRequested: boolean,
  inputPath: string,
  outDirPath: string,
  audioPath: string,
): Promise<string> {
  if (!remuxRequested) {
    return audioPath;
  }

  const remuxedPath: string = path.join(outDirPath, "dubbed.mp4");

  await runCommand(
    "ffmpeg",
    ["-y", "-i", inputPath, "-i", audioPath, "-map", "0:v", "-map", "1:a", "-c:v", "copy", remuxedPath],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );

  return remuxedPath;
}

async function cleanupWorkDir(workDirPath: string, keepIntermediates: boolean): Promise<void> {
  if (keepIntermediates) {
    return;
  }

  await fs.rm(workDirPath, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const options: CliOptions = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  try {
    assertReadableInputFile(options.inputPath);
  } catch {
    throw new Error(`Input file is not readable: ${options.inputPath}`);
  }

  await assertInputIsFile(options.inputPath);

  const inputPath: string = path.resolve(options.inputPath);
  const outDirPath: string = path.resolve(options.outDir);
  const workDirPath: string = path.join(outDirPath, WORK_DIR_NAME);
  const transcribeDirPath: string = path.join(workDirPath, TRANSCRIBE_DIR_NAME);
  const sourceWavPath: string = path.join(workDirPath, "source.wav");
  const referenceWavPath: string = path.join(workDirPath, "reference.wav");
  const dubbedWavPath: string =
    options.format === "wav" ? path.join(outDirPath, "dubbed.wav") : path.join(workDirPath, "dubbed.wav");

  const backends = createBackends({
    pythonPath: options.pythonPath,
    openVoiceRoot: options.openVoiceRoot,
  });
  const backend: TtsBackend = selectBackend(backends, options.ttsName);

  await fs.mkdir(outDirPath, { recursive: true });
  await fs.rm(workDirPath, { recursive: true, force: true });
  await fs.mkdir(workDirPath, { recursive: true });

  await runPreflight(backend);

  await runCommand(
    "ffmpeg",
    ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", sourceWavPath],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(options.refStart),
      "-t",
      String(options.refDuration),
      "-i",
      sourceWavPath,
      "-c",
      "copy",
      referenceWavPath,
    ],
    { timeoutMs: FFMPEG_TIMEOUT_MS },
  );

  const totalDurationSec: number = await probeDurationSec(sourceWavPath);
  const transcribedSegments: Segment[] = await transcribeToSegments(
    sourceWavPath,
    transcribeDirPath,
    options.whisperModel,
    options.translateMode,
  );
  const translatedSegments: Segment[] = translateSegments(transcribedSegments, options.translateMode);
  const synthDurationsSec: number[] = await synthesizeSegments(
    backend,
    translatedSegments,
    referenceWavPath,
    workDirPath,
  );
  const plan = planTimeline(translatedSegments, synthDurationsSec, totalDurationSec);

  logOverruns(plan.overruns);
  await assembleDubbedWav(plan.placements, workDirPath, dubbedWavPath, plan.totalDurationSec);

  const finalAudioPath: string = await maybeEncodeMp3(options.format, outDirPath, dubbedWavPath);
  const finalOutputPath: string = await maybeRemux(options.remux, inputPath, outDirPath, finalAudioPath);

  await cleanupWorkDir(workDirPath, options.keepIntermediates);
  process.stdout.write(`Final output: ${finalOutputPath}\n`);
}

void main().catch((error: unknown) => {
  const message: string = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
