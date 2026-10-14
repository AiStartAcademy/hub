import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface RunResult {
  stdout: string;
  stderr: string;
}

// ffmpeg can run for a long time on full-length lecture renders and remuxes.
export const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;

// ffprobe should return metadata quickly even for large media inputs.
export const FFPROBE_TIMEOUT_MS = 60 * 1000;

// large-v3 transcription on long lectures can legitimately take multiple hours.
export const TRANSCRIBE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// A single TTS segment should finish within minutes even on CPU fallback.
export const SYNTHESIS_TIMEOUT_MS = 10 * 60 * 1000;

const FORCE_KILL_GRACE_MS = 2_000;

function getInstallHint(command: string): string {
  const binaryName = path.basename(command);

  if (binaryName === "ffmpeg" || binaryName === "ffprobe") {
    return "brew install ffmpeg";
  }

  if (binaryName.startsWith("python")) {
    return "install Python 3 and pass a valid interpreter path";
  }

  return `install ${binaryName} via your package manager or pass an absolute path`;
}

function formatExitError(command: string, code: number | null, signal: NodeJS.Signals | null, stderr: string): Error {
  const binaryName = path.basename(command);
  const stderrText = stderr.trim() || "(no stderr)";

  if (code !== null) {
    return new Error(`${binaryName} exited with code ${code}: ${stderrText}`);
  }

  return new Error(`${binaryName} exited due to signal ${signal ?? "unknown"}: ${stderrText}`);
}

export async function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; cwd?: string },
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishResolve = (result: RunResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(forceKillHandle);
      resolve(result);
    };

    const finishReject = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(forceKillHandle);
      reject(error);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        const binaryName = path.basename(command);
        finishReject(new Error(`${binaryName} not found on PATH — install via ${getInstallHint(command)}`));
        return;
      }

      finishReject(error instanceof Error ? error : new Error(String(error)));
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        finishResolve({ stdout, stderr });
        return;
      }

      finishReject(formatExitError(command, code, signal, stderr));
    });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      forceKillHandle = setTimeout(() => {
        child.kill("SIGKILL");
      }, FORCE_KILL_GRACE_MS);
      finishReject(new Error(`${path.basename(command)} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    let forceKillHandle: NodeJS.Timeout | undefined;
  });
}

async function assertNonEmptyFile(filePath: string, backendName: string): Promise<void> {
  let fileStat;

  try {
    fileStat = await fs.stat(filePath);
  } catch {
    throw new Error(`${backendName} did not create the expected output file: ${filePath}`);
  }

  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`${backendName} produced an empty output file: ${filePath}`);
  }
}

async function assertDirectoryExists(dirPath: string, description: string): Promise<void> {
  let directoryStat;

  try {
    directoryStat = await fs.stat(dirPath);
  } catch {
    throw new Error(`${description} does not exist: ${dirPath}`);
  }

  if (!directoryStat.isDirectory()) {
    throw new Error(`${description} is not a directory: ${dirPath}`);
  }
}

export async function probeDurationSec(mediaPath: string): Promise<number> {
  const result = await runCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      mediaPath,
    ],
    { timeoutMs: FFPROBE_TIMEOUT_MS },
  );

  const rawOutput = result.stdout.trim();
  const durationSec = Number.parseFloat(rawOutput);

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`ffprobe returned an invalid duration for ${mediaPath}: ${JSON.stringify(rawOutput)}`);
  }

  return durationSec;
}

export interface SynthesisRequest {
  text: string;
  referenceAudioPath: string;
  outputPath: string;
  language: "en";
}

export interface TtsBackend {
  readonly name: string;
  preflight(): Promise<void>;
  synthesize(request: SynthesisRequest): Promise<void>;
}

export interface BackendOptions {
  pythonPath: string;
  openVoiceRoot?: string;
}

export const DEFAULT_TTS_BACKEND = "mlx-audio";

function buildMlxAudioGenerateModuleArgs(request: SynthesisRequest): string[] {
  // Keep the version-sensitive mlx-audio CLI contract in one place because releases vary.
  return [
    "-m",
    "mlx_audio.generate",
    "--text",
    request.text,
    "--reference-audio",
    request.referenceAudioPath,
    "--output",
    request.outputPath,
    "--language",
    request.language,
  ];
}

function buildOpenVoiceApiArgs(openVoiceRoot: string, request: SynthesisRequest): string[] {
  const apiScriptPath = path.join(openVoiceRoot, "openvoice", "api.py");
  const checkpointsPath = path.join(openVoiceRoot, "checkpoints_v2");

  return [
    apiScriptPath,
    "--text",
    request.text,
    "--reference-audio",
    request.referenceAudioPath,
    "--output",
    request.outputPath,
    "--language",
    request.language,
    "--checkpoint-dir",
    checkpointsPath,
    "--device",
    "cpu",
  ];
}

function createMlxAudioBackend(pythonPath: string): TtsBackend {
  return {
    name: "mlx-audio",
    async preflight(): Promise<void> {
      try {
        await runCommand(pythonPath, ["-c", "import mlx_audio"], { timeoutMs: FFPROBE_TIMEOUT_MS });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`mlx-audio preflight failed. Install it with: pip install mlx-audio\n${errorMessage}`);
      }
    },
    async synthesize(request: SynthesisRequest): Promise<void> {
      await runCommand(pythonPath, buildMlxAudioGenerateModuleArgs(request), {
        timeoutMs: SYNTHESIS_TIMEOUT_MS,
      });
      await assertNonEmptyFile(request.outputPath, "mlx-audio");
    },
  };
}

function createOpenVoiceBackend(options: BackendOptions): TtsBackend {
  return {
    name: "openvoice",
    async preflight(): Promise<void> {
      process.stderr.write(
        [
          "OpenVoice warning: CPU-only backend on this machine.",
          "MeloTTS issue #228 leaves Apple Silicon MPS unusable, so CPU fallback is required.",
          "OpenVoice issue #133 was closed without an MPS fix, so OpenVoice v2 remains CPU-only here.",
          "Use a dedicated Python 3.9 virtualenv for OpenVoice and MeloTTS compatibility.",
        ].join("\n") + "\n",
      );

      if (!options.openVoiceRoot) {
        throw new Error(
          "OpenVoice backend requires `openVoiceRoot`; pass the OpenVoice checkout path that contains checkpoints_v2.",
        );
      }

      await runCommand(options.pythonPath, ["--version"], { timeoutMs: FFPROBE_TIMEOUT_MS });
      await assertDirectoryExists(options.openVoiceRoot, "OpenVoice root");
      await assertDirectoryExists(path.join(options.openVoiceRoot, "checkpoints_v2"), "OpenVoice checkpoints_v2");
    },
    async synthesize(request: SynthesisRequest): Promise<void> {
      if (!options.openVoiceRoot) {
        throw new Error(
          "OpenVoice backend requires `openVoiceRoot`; pass the OpenVoice checkout path that contains checkpoints_v2.",
        );
      }

      await runCommand(options.pythonPath, buildOpenVoiceApiArgs(options.openVoiceRoot, request), {
        timeoutMs: SYNTHESIS_TIMEOUT_MS,
        cwd: options.openVoiceRoot,
      });
      await assertNonEmptyFile(request.outputPath, "openvoice");
    },
  };
}

export function createBackends(options: BackendOptions): Record<string, TtsBackend> {
  return {
    [DEFAULT_TTS_BACKEND]: createMlxAudioBackend(options.pythonPath),
    openvoice: createOpenVoiceBackend(options),
  };
}

export function selectBackend(backends: Record<string, TtsBackend>, name: string): TtsBackend {
  const selectedBackend = backends[name];

  if (selectedBackend) {
    return selectedBackend;
  }

  const validNames = Object.keys(backends).sort().join(", ");
  throw new Error(`Unknown TTS backend "${name}". Valid backends: ${validNames}`);
}
