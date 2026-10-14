# dub-audio

`dub-audio` is a Bun CLI for audio-only dubbing. It extracts mono 16 kHz audio with `ffmpeg`, cuts a short reference clip for voice cloning, transcribes or translates with `mlx_whisper`, runs per-segment TTS, places each synthesized segment on the original timeline with `ffmpeg` `adelay` + `amix`, writes `dubbed.wav` or `dubbed.mp3`, and can optionally remux the new audio back into an MP4.

## Files

- `scripts/dub-audio/core.ts` - pure logic: `parseSrt`, `parseWhisperJson`, `planTimeline`, `formatTimestamp`.
- `scripts/dub-audio/backends.ts` - `runCommand`, `probeDurationSec`, TTS backend registry (`mlx-audio` default, `openvoice`), and timeout constants.
- `scripts/dub-audio/dub-audio.ts` - CLI entrypoint and end-to-end pipeline.
- `tests/unit/dubAudio.test.ts` - unit tests for the pure logic.

## What it does / what it does not

What it does:

- Audio-only dubbing from an input media file.
- Segment-level timing alignment based on subtitle timestamps.
- Single-speaker voice cloning from a short reference clip.
- Final output as WAV or MP3, with optional MP4 remux.

What it does not do:

- No frame-accurate lip sync.
- No phoneme-level or word-level retiming.
- No diarization or multi-speaker separation. The pipeline assumes a single speaker.
- No automatic high-quality machine translation stage beyond Whisper's built-in translate mode.

## Requirements

- macOS on Apple Silicon.
- `ffmpeg` and `ffprobe` on `PATH`:

```bash
brew install ffmpeg
```

- Bun.
- A dedicated Python 3.9 or 3.10 virtual environment. The system `python3` on this machine is `3.14.6` as of July 31, 2026, and it will not work for MeloTTS or OpenVoice.

Create a dedicated virtual environment and point `--python` at it:

```bash
python3 --version
# Python 3.14.6 on this machine - do not use it for this toolchain

python3.10 -m venv .venv-dub-audio
source .venv-dub-audio/bin/activate
python -m pip install --upgrade pip
```

The interpreter you pass to the CLI should be the venv Python, for example:

```bash
--python "$PWD/.venv-dub-audio/bin/python"
```

## Install - mlx-whisper

Install `mlx-whisper` into the dedicated venv:

```bash
source .venv-dub-audio/bin/activate
pip install mlx-whisper
```

- License: MIT.
- Default model in this CLI: `mlx-community/whisper-large-v3-mlx`.
- Faster alternative: `mlx-community/whisper-large-v3-turbo`.
- Models download from Hugging Face on first use. `whisper-large-v3-mlx` is multi-GB, so expect a large initial download.

## Install - TTS backends

### `mlx-audio` (default, recommended)

Install into the same venv:

```bash
source .venv-dub-audio/bin/activate
pip install mlx-audio
```

- License: MIT for the wrapper.
- Model weights are separate artifacts and can carry their own licenses. Check the license for the specific weights you use.
- This is the default backend used when `--tts` is omitted.

### `openvoice` (not recommended on Apple Silicon)

Install in a dedicated Python 3.9 or 3.10 environment:

```bash
git clone https://github.com/myshell-ai/OpenVoice.git
cd OpenVoice
pip install -e .
curl -LO https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip
unzip checkpoints_v2_0417.zip
brew install mecab            # BEFORE MeloTTS, or mecab-python3 can fail to build
pip install git+https://github.com/myshell-ai/MeloTTS.git
python -m unidic download     # mandatory, even for English-only use
```

Notes:

- Install `mecab` before MeloTTS or `mecab-python3` can fail to build.
- `python -m unidic download` is mandatory and downloads a large Japanese dictionary, roughly 500 MB, even if you only plan to synthesize English.
- The CLI requires both `--tts openvoice` and `--openvoice-root <path>`, and you should also pass the venv Python explicitly. `--openvoice-root` should point at the checkout that contains `checkpoints_v2`.

Example:

```bash
bun scripts/dub-audio/dub-audio.ts \
  --input video.mp4 \
  --tts openvoice \
  --openvoice-root "$HOME/src/OpenVoice" \
  --python "$PWD/.venv-dub-audio/bin/python"
```

## Usage

### End-to-end example

```bash
bun scripts/dub-audio/dub-audio.ts \
  --input video.mp4 \
  --out-dir ./dub-out \
  --python "$PWD/.venv-dub-audio/bin/python"
```

### Remux example

```bash
bun scripts/dub-audio/dub-audio.ts \
  --input video.mp4 \
  --python "$PWD/.venv-dub-audio/bin/python" \
  --remux
```

### Debugging example

```bash
bun scripts/dub-audio/dub-audio.ts \
  --input video.mp4 \
  --python "$PWD/.venv-dub-audio/bin/python" \
  --keep-intermediates
```

With `--keep-intermediates`, the tool keeps `work/`, including extracted source audio, the reference clip, the transcription output, and per-segment synthesized WAVs.

### CLI flags

```text
--input <path>                  Required input media file
--out-dir <path>                Output directory (default: ./dub-out)
--tts <name>                    TTS backend (default: mlx-audio)
--translate-mode <mode>         whisper-translate | transcribe-then-translate
--format <format>               wav | mp3 (default: wav)
--ref-start <seconds>           Reference clip start offset (default: 0)
--ref-duration <seconds>        Reference clip duration (default: 30)
--whisper-model <name>          Whisper model (default: mlx-community/whisper-large-v3-mlx)
--python <path>                 Python interpreter (default: python3)
--openvoice-root <path>         OpenVoice checkout root (required for openvoice)
--remux                         Remux dubbed audio back into an MP4
--keep-intermediates            Keep work/ intermediates
--help                          Show help and exit
```

`--translate-mode transcribe-then-translate` is intentionally not wired through to a translator yet. In the current code, `translateSegments()` in `scripts/dub-audio/dub-audio.ts` throws loudly after transcription and before TTS, instead of silently feeding untranslated Russian text into the English-only TTS backend.

## Known limitations

### OpenVoice on Apple Silicon

OpenVoice v2 is CPU-only on Apple Silicon in this toolchain.

- The local backend wrapper forces `--device cpu` for `openvoice`.
- Upstream `openvoice/api.py` branches on CUDA, not MPS.
- OpenVoice issue `#133` ("please support mac m1/m2/m3 mps metal") is closed, but there is still no usable MPS path in the code this tool relies on.
- MeloTTS issue `#228` is still open as of July 31, 2026 and documents the `Output channels > 65536 not supported at the MPS device` failure on Apple Silicon.
- The documented workarounds for that MeloTTS failure, such as `PYTORCH_ENABLE_MPS_FALLBACK=1` or forcing `device='cpu'`, still end up on CPU.
- As of July 31, 2026, the OpenVoice repository page shows its latest code update on April 19, 2025 and 284 open issues. Do not assume Apple Silicon support is actively moving.

### Speed

Speed is unbenchmarked here. There is no benchmark number in this README because none has been established for this toolchain that would be credible enough to rely on. Measure it yourself on a 60 second clip before committing to a larger batch.

### Translation quality

Whisper's built-in `--task translate` is a reasonable baseline, but it is not strong on technical or business jargon. The alternative mode, `--translate-mode transcribe-then-translate`, exists specifically as the seam for a stronger dedicated MT or LLM step. Right now that path fails loudly in `translateSegments()` rather than silently passing Russian transcript text through to the English-only TTS stage.

### Timing

Timing is segment-level only. If synthesized speech overruns the subtitle slot, the tool logs a warning for that segment and does not truncate it. Long overruns can spill into the next segment.

### Speaker model

The pipeline assumes a single speaker. There is no diarization, no speaker separation, and no per-speaker voice assignment.

## Follow-up manual remux command

The CLI can do this with `--remux`, but the equivalent manual command is:

```bash
ffmpeg -i video.mp4 -i dubbed.wav -map 0:v -map 1:a -c:v copy output.mp4
```

## Do not commit generated outputs

Do not commit generated audio, remuxed video, or downloaded model checkpoints. `scripts/dub-audio/.gitignore` already covers the tool's own local outputs such as `dub-out/`, `*.wav`, `*.mp3`, `*.srt`, and `work/`.
