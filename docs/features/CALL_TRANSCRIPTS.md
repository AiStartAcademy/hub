# Call Transcripts

The hub stores staff-visible, non-anonymized call transcripts on `ContactCall.transcript`
(shown in the lead profile timeline). A local TypeScript runner can fetch Twilio recordings
through the hub, produce speaker-labeled transcripts with Whisper, write them back, and
separately produce anonymized Markdown for sharing.

`ContactCall` also holds `providerCallId` (unique), `recordingUrl`, `summary` and `analysis`
(JSON text). Recording URLs for Twilio calls point at the hub's own proxy route
`/api/twilio/recordings/[sid]`.

## Internal MCP endpoints

All three require `Authorization: Bearer <HUB_MCP_TOKEN>`, return
`Cache-Control: private, no-store`, and never expose phone numbers. See
[../MCP_API.md](../MCP_API.md).

### `GET /api/internal/mcp/v1/calls`

Bounded, field-allowlisted list. Query parameters:

- `needsTranscript=1`: only calls with a recording URL and a null or empty transcript.
- `provider`: exact provider, default `twilio`.
- `since`: date/time applied to `startedAt`; invalid values return `400`.
- `providerCallId`: optional exact provider id (used by `push`).
- `limit`: default 50, maximum 200.
- `cursor`: opaque call id from `nextCursor`.

Items contain only `id`, `providerCallId`, direction, status, duration, start time, the parsed
`recordingSid`, `hasTranscript`, `contactId`, `contactName` and `authorLabel`. Transcript text,
phone numbers and recording credentials are never returned.

### `GET /api/internal/mcp/v1/calls/:id/recording`

Validates the call's stored proxy URL and its `RE…` recording SID, then streams
`Recordings/{sid}.wav?RequestedChannels=2` from Twilio with a 30-second timeout. Missing call
or recording returns `404`, a malformed stored SID `400`, and missing credentials, timeouts or
upstream failures `502`. Credentials and upstream bodies are never returned or logged.

### `PATCH /api/internal/mcp/v1/calls/:id`

Accepts any of `transcript`, `summary`, `analysis` (strings) and an optional boolean `force`.
`analysis` must be valid JSON text. Unknown fields, empty bodies, wrong types and transcripts
over 100,000 characters return `400`. An existing non-empty transcript is protected with `409`
unless `force: true`. Writes also require `HUB_MCP_WRITES_ENABLED` to be exactly `true`
(Integrations store, env fallback). Logs contain ids and field lengths only.

## Local runner

`scripts/call-transcripts/` (Bun; full usage in `scripts/call-transcripts/README.md`). It needs
`ffmpeg`/`ffprobe`, `uvx`, and Apple Silicon for `mlx-whisper`.

- `list`, and `run --source twilio` (the default), talk to Twilio directly with
  `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
- `run --source hub` uses `HUB_URL` and `HUB_MCP_TOKEN`: pages through calls needing
  transcripts, downloads via the hub, transcribes locally, and writes back unless
  `--no-writeback` is set.
- `push --out <dir>` uploads existing local transcripts, resolving each hub row by Twilio
  CallSid. Because it is an explicit sync, it forces replacement.
- `anonymize --out <dir> --drive-dir <dir>` writes redacted `transcripts/call-NNN.md`. Hub mode
  keeps contact names in a local `<out>/call-names.csv` keyed by CallSid, which `anonymize`
  reads automatically for name redaction. It is never sent back to the hub.

## PII boundary

Everything under `--out` (audio, raw speaker-labeled transcripts, Twilio ids, name lookups,
mapping files, indexes) is local-only PII. Never commit it or share it.

The hub intentionally keeps the non-anonymized transcript for staff use. Only the anonymized
Markdown under `<drive-dir>/transcripts`, after the CLI's leak checks pass, is meant to leave
the machine. The runner never uploads raw audio or lookup files anywhere.

## Key files

| File | Role |
|------|------|
| `src/app/api/internal/mcp/v1/calls/route.ts` | List endpoint |
| `src/app/api/internal/mcp/v1/calls/[id]/route.ts` | PATCH endpoint |
| `src/app/api/internal/mcp/v1/calls/[id]/recording/route.ts` | Recording proxy |
| `src/lib/calls/internalApi.ts` | Query and patch parsing, transcript cap |
| `src/lib/calls/routeHandlers.ts` | Handlers (auth, 409 guard, Twilio fetch) |
| `scripts/call-transcripts/` | Local runner |

Related: [LEADS.md](./LEADS.md), [VAPI_RECEPTIONIST.md](./VAPI_RECEPTIONIST.md).
