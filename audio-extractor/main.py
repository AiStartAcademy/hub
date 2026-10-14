from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from google.api_core.exceptions import GoogleAPIError, NotFound
from google.cloud import storage
from google.cloud.storage.blob import Blob
from google.cloud.storage.bucket import Bucket
from google.oauth2 import service_account
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask

app = FastAPI(title="Audio Extractor")

FFMPEG_BINARY = "ffmpeg"
FFPROBE_BINARY = "ffprobe"
STREAM_CHUNK_SIZE = 1024 * 1024
GCS_REQUIRED_ENV_VARS = (
    "GCS_PROJECT_ID",
    "GCS_CLIENT_EMAIL",
    "GCS_PRIVATE_KEY",
    "GCS_BUCKET_NAME",
)

ALLOWED_FORMATS: dict[str, tuple[str, str]] = {
    "mp3": ("libmp3lame", "audio/mpeg"),
    "aac": ("aac", "audio/aac"),
    "ogg": ("libvorbis", "audio/ogg"),
}

_cached_bucket: Bucket | None = None


class GcsAudioExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    videoObjectKey: str
    audioObjectKey: str
    format: str = Field(default="mp3")
    q: int = Field(default=5, ge=0, le=9)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def normalize_private_key(key: str | None) -> str | None:
    if not key:
        return key

    normalized_key = re.sub(r'(^["\']|["\']$)', "", key)
    return normalized_key.replace("\\n", "\n")


def remove_temp_directory(path: str) -> None:
    shutil.rmtree(path)


def get_output_settings(format_name: str) -> tuple[str, str]:
    settings = ALLOWED_FORMATS.get(format_name)
    if settings is None:
        raise HTTPException(status_code=400, detail=f"Unsupported format. Use: {list(ALLOWED_FORMATS)}")
    return settings


def get_env_value(env_values: dict[str, str | None], name: str) -> str:
    value = env_values.get(name)
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing required GCS environment variable: {name}")
    return value


def get_bucket() -> Bucket:
    global _cached_bucket

    if _cached_bucket is not None:
        return _cached_bucket

    env_values = {name: os.getenv(name) for name in GCS_REQUIRED_ENV_VARS}
    missing_vars = [name for name, value in env_values.items() if not value]
    if missing_vars:
        missing_list = ", ".join(missing_vars)
        raise HTTPException(status_code=500, detail=f"Missing required GCS environment variables: {missing_list}")

    project_id = get_env_value(env_values, "GCS_PROJECT_ID")
    client_email = get_env_value(env_values, "GCS_CLIENT_EMAIL")
    private_key = normalize_private_key(get_env_value(env_values, "GCS_PRIVATE_KEY"))
    bucket_name = get_env_value(env_values, "GCS_BUCKET_NAME")
    if private_key is None:
        raise HTTPException(status_code=500, detail="Missing required GCS environment variable: GCS_PRIVATE_KEY")

    service_account_info = {
        "type": "service_account",
        "project_id": project_id,
        "client_email": client_email,
        "private_key": private_key,
        "token_uri": "https://oauth2.googleapis.com/token",
    }

    try:
        credentials = service_account.Credentials.from_service_account_info(service_account_info)
        client = storage.Client(project=project_id, credentials=credentials)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize GCS client: {exc}") from exc

    _cached_bucket = client.bucket(bucket_name)
    return _cached_bucket


async def write_upload_to_file(upload: UploadFile, destination_path: str) -> None:
    try:
        with open(destination_path, "wb") as destination:
            while True:
                chunk = await upload.read(STREAM_CHUNK_SIZE)
                if not chunk:
                    break
                destination.write(chunk)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write upload to temporary file: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read uploaded file: {exc}") from exc


def run_audio_extraction(input_path: str, output_path: str, codec: str, q: int) -> None:
    try:
        result = subprocess.run(
            [
                FFMPEG_BINARY,
                "-y",
                "-i",
                input_path,
                "-vn",
                "-acodec",
                codec,
                "-q:a",
                str(q),
                output_path,
            ],
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to execute {FFMPEG_BINARY}: {exc}") from exc

    stderr_text = result.stderr if isinstance(result.stderr, str) else repr(result.stderr)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"{FFMPEG_BINARY} error: {stderr_text}")
    if not os.path.exists(output_path):
        raise HTTPException(status_code=500, detail=f"Audio output file was not created: {output_path}")


def probe_duration_seconds(file_path: str) -> float | None:
    try:
        result = subprocess.run(
            [
                FFPROBE_BINARY,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                file_path,
            ],
            capture_output=True,
            text=True,
        )
    except OSError:
        return None

    if result.returncode != 0 or not isinstance(result.stdout, str) or not result.stdout.strip():
        return None

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    format_payload = payload.get("format")
    if not isinstance(format_payload, dict):
        return None

    duration_value = format_payload.get("duration")
    if not isinstance(duration_value, str):
        return None

    try:
        duration_seconds = float(duration_value)
    except ValueError:
        return None

    if not math.isfinite(duration_seconds):
        return None

    return duration_seconds


def get_existing_blob(bucket: Bucket, object_key: str) -> Blob:
    blob = bucket.blob(object_key)
    try:
        exists = blob.exists()
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=f"GCS object not found: {object_key}") from exc
    except GoogleAPIError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to check GCS object {object_key}: {exc}") from exc

    if not isinstance(exists, bool):
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected exists() response for GCS object {object_key}: {exists!r}",
        )
    if not exists:
        raise HTTPException(status_code=404, detail=f"GCS object not found: {object_key}")

    return blob


def download_blob_to_file(bucket: Bucket, object_key: str, destination_path: str) -> None:
    blob = get_existing_blob(bucket, object_key)
    try:
        blob.download_to_filename(destination_path)
    except NotFound as exc:
        raise HTTPException(status_code=404, detail=f"GCS object not found: {object_key}") from exc
    except GoogleAPIError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to download GCS object {object_key}: {exc}") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write downloaded GCS object {object_key}: {exc}") from exc


def upload_file_to_blob(bucket: Bucket, object_key: str, source_path: str, content_type: str) -> int:
    blob = bucket.blob(object_key)
    try:
        blob.upload_from_filename(source_path, content_type=content_type)
    except GoogleAPIError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to upload GCS object {object_key}: {exc}") from exc

    try:
        return os.path.getsize(source_path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to stat extracted audio file {source_path}: {exc}") from exc


@app.post("/extract-audio")
async def extract_audio(
    file: UploadFile = File(...),
    q: int = Query(default=5, ge=0, le=9, description="Audio quality (0=best, 9=worst)"),
    format: str = Query(default="mp3", description="Output format: mp3, aac, ogg"),
) -> FileResponse:
    codec, media_type = get_output_settings(format)
    temp_directory = tempfile.mkdtemp()
    input_path = os.path.join(temp_directory, "input")
    output_path = os.path.join(temp_directory, f"output.{format}")

    try:
        await write_upload_to_file(file, input_path)
        run_audio_extraction(input_path, output_path, codec, q)
        return FileResponse(
            output_path,
            media_type=media_type,
            filename=f"audio.{format}",
            background=BackgroundTask(remove_temp_directory, temp_directory),
        )
    except Exception:
        remove_temp_directory(temp_directory)
        raise
    finally:
        await file.close()


@app.post("/extract-audio-gcs")
def extract_audio_gcs(payload: GcsAudioExtractionRequest) -> dict[str, str | int | float | None]:
    codec, media_type = get_output_settings(payload.format)
    bucket = get_bucket()

    with tempfile.TemporaryDirectory() as temp_directory:
        input_path = os.path.join(temp_directory, "input")
        output_path = os.path.join(temp_directory, f"output.{payload.format}")

        download_blob_to_file(bucket, payload.videoObjectKey, input_path)
        run_audio_extraction(input_path, output_path, codec, payload.q)
        uploaded_bytes = upload_file_to_blob(bucket, payload.audioObjectKey, output_path, media_type)
        duration_seconds = probe_duration_seconds(output_path)

    return {
        "audioObjectKey": payload.audioObjectKey,
        "bytes": uploaded_bytes,
        "durationSec": duration_seconds,
    }
