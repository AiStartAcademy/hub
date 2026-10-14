# Audio Extractor

This service extracts audio with `ffmpeg` and supports two execution paths:

- `POST /extract-audio` accepts a multipart upload and returns extracted audio bytes.
- `POST /extract-audio-gcs` reads the source video from GCS and writes the extracted audio back to GCS, so only JSON crosses the network.

## Endpoints

### `GET /health`

Response:

```json
{"status":"ok"}
```

### `POST /extract-audio`

Query parameters:

- `format` optional, default `mp3`, allowed values `mp3`, `aac`, `ogg`
- `q` optional, default `5`, valid range `0` to `9`

Example:

```bash
curl -X POST "http://localhost:8000/extract-audio?format=mp3&q=5" \
  -F "file=@/path/to/video.mp4" \
  --output lesson-audio.mp3
```

Success response:

- Status `200`
- Body is the extracted audio bytes
- `Content-Type` matches the requested format
- `Content-Disposition: attachment; filename="audio.<format>"`

### `POST /extract-audio-gcs`

JSON body:

```json
{
  "videoObjectKey": "courses/ai/module-1/lesson-1/video.mp4",
  "audioObjectKey": "courses/ai/module-1/lesson-1/audio.mp3",
  "format": "mp3",
  "q": 5
}
```

Fields:

- `videoObjectKey` required source object key in `GCS_BUCKET_NAME`
- `audioObjectKey` required destination object key in `GCS_BUCKET_NAME`
- `format` optional, default `mp3`, allowed values `mp3`, `aac`, `ogg`
- `q` optional, default `5`, valid range `0` to `9`

Example:

```bash
curl -X POST "http://localhost:8000/extract-audio-gcs" \
  -H "Content-Type: application/json" \
  -d '{
    "videoObjectKey": "courses/ai/module-1/lesson-1/video.mp4",
    "audioObjectKey": "courses/ai/module-1/lesson-1/audio.mp3",
    "format": "mp3",
    "q": 5
  }'
```

Success response shape:

```json
{
  "audioObjectKey": "courses/ai/module-1/lesson-1/audio.mp3",
  "bytes": 123456789,
  "durationSec": 7425.184
}
```

Notes:

- Missing source objects return `404`.
- If `ffprobe` is unavailable or probe parsing fails, `durationSec` is `null` and the extraction still succeeds.

## Required Environment Variables
## Required Environment Variables

These mirror the hub's `src/lib/gcs.ts`, so the hub and the extractor can share one set of storage credentials.

- `GCS_PROJECT_ID`: GCP project id used to initialize the storage client.
- `GCS_CLIENT_EMAIL`: service-account client email.
- `GCS_PRIVATE_KEY`: service-account private key. The service strips wrapping quotes and converts literal `\n` to real newlines exactly like the hub.
- `GCS_BUCKET_NAME`: bucket that stores both the source video and extracted audio objects.

## Build And Run

```bash
docker build -t audio-extractor ./audio-extractor
docker run --rm -p 8000:8000 --env-file .env audio-extractor
```

Example Kubernetes manifests live in [`k8s/`](./k8s/); adapt the names, namespace and image to your cluster.

## Pointing The Hub At The Service

Set `EXTRACT_AUDIO_SERVICE_URL` in the hub's environment to the extractor's `/extract-audio-gcs` endpoint, for example:

```text
http://audio-extractor:8000/extract-audio-gcs
```

Use whatever hostname your network gives the service (a compose service name, a Kubernetes Service DNS name, or a private load balancer).
