import { createHmac, timingSafeEqual } from "node:crypto";

const ZOOM_WEBHOOK_VERSION = "v0";
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

type VerifyZoomWebhookSignatureInput = {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowMs?: number;
};

type VerifyZoomWebhookSignatureResult =
  | { ok: true }
  | { ok: false; reason: string };

function buildZoomWebhookSignature(
  rawBody: string,
  timestamp: string,
  secret: string
): string {
  const message = `${ZOOM_WEBHOOK_VERSION}:${timestamp}:${rawBody}`;
  const hash = createHmac("sha256", secret).update(message).digest("hex");
  return `${ZOOM_WEBHOOK_VERSION}=${hash}`;
}

export function verifyZoomWebhookSignature(
  input: VerifyZoomWebhookSignatureInput
): VerifyZoomWebhookSignatureResult {
  const { rawBody, signature, timestamp, secret, nowMs = Date.now() } = input;

  if (!signature) {
    return { ok: false, reason: "Missing Zoom webhook signature header" };
  }

  if (!timestamp) {
    return { ok: false, reason: "Missing Zoom webhook timestamp header" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "Invalid Zoom webhook timestamp header" };
  }

  const timestampMs = timestampSeconds * 1000;
  if (Math.abs(nowMs - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "Zoom webhook timestamp is outside the allowed window" };
  }

  const expectedSignature = buildZoomWebhookSignature(rawBody, timestamp, secret);
  const providedSignatureBuffer = Buffer.from(signature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");

  if (providedSignatureBuffer.length !== expectedSignatureBuffer.length) {
    return { ok: false, reason: "Zoom webhook signature length mismatch" };
  }

  const signaturesMatch = timingSafeEqual(
    providedSignatureBuffer,
    expectedSignatureBuffer
  );

  if (!signaturesMatch) {
    return { ok: false, reason: "Zoom webhook signature mismatch" };
  }

  return { ok: true };
}
