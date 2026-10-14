# Call transcripts

Local-only CLI for downloading Twilio recordings directly or through the Hub, transcribing their channels with Whisper, and producing anonymized Markdown safe to copy to Drive.

> **PII warning:** the directory passed as `--out` contains phone numbers, Twilio IDs, recordings, and raw transcripts. Never commit it or copy it to Drive. Only `<drive-dir>/transcripts` is intended for Drive after the leak checks pass.

## Prerequisites

- Bun
- `ffmpeg` and `ffprobe`
- `uv`/`uvx`
- Apple Silicon for `mlx-whisper`
- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` for `list` and the default `run --source twilio`
- `HUB_URL` and `HUB_MCP_TOKEN` for `run --source hub` and `push`

## Commands

```bash
bun scripts/call-transcripts/call-transcripts.ts list

bun scripts/call-transcripts/call-transcripts.ts run \
  --out ./private-call-data --since 2026-01-01 --limit 10 \
  --min-duration 20 --whisper-cmd "uvx --from mlx-whisper mlx_whisper" \
  --model mlx-community/whisper-large-v3-turbo

bun scripts/call-transcripts/call-transcripts.ts run \
  --source hub --out ./private-call-data --since 2026-01-01 --limit 10

bun scripts/call-transcripts/call-transcripts.ts run \
  --source hub --no-writeback --out ./private-call-data

bun scripts/call-transcripts/call-transcripts.ts push --out ./private-call-data

bun scripts/call-transcripts/call-transcripts.ts anonymize \
  --out ./private-call-data --drive-dir ./drive-export \
  --names-csv ./private-call-data/names.csv \
  --closer-names "Jane,Jane Doe" \
  --entities-cmd "./detect-entities"
```

`run` defaults to `--source twilio`. Hub mode pages through calls whose recording exists and transcript is empty, downloads audio through the authenticated Hub recording endpoint, and writes the speaker-labeled transcript back to `ContactCall.transcript`. `--no-writeback` keeps the Hub unchanged. `push --out <dir>` uploads transcripts already present in local `raw/` files, resolving each Hub call by its Twilio CallSid; because `push` is an explicit synchronization command, it forces replacement of an existing Hub transcript.

`names.csv` has columns `phone,name`. Hub mode also maintains `<out>/call-names.csv` with columns `callSid,name`; `anonymize` reads it automatically and prefers its CallSid match over the optional phone lookup. Both files are local-only PII and must never be uploaded. The optional entity command receives the already-redacted transcript on stdin and must return `{"entities":[{"text":"Acme","type":"COMPANY"}]}` on stdout; supported types are `PERSON`, `COMPANY`, and `CITY`.

Use `--swap-channels` when Twilio's channel roles are reversed, and `--force` to reprocess existing raw JSON. Transcript timestamps use `[MM:SS]` with unbounded minutes, so one hour and one minute is `[61:00]`.

## Output

```text
<out>/
  audio/RE….wav          # PII: downloaded recordings
  raw/CA….txt            # PII: speaker transcript
  raw/CA….json           # PII: transcript plus Twilio metadata
  index.csv              # PII: processing index
  mapping.csv            # PII: neutral ID mapping
  call-names.csv         # PII: Hub contact-name lookup keyed by CallSid
  .work/                 # temporary channel and Whisper files

<drive-dir>/
  transcripts/call-NNN.md # anonymized output; safe for Drive after checks pass
```
