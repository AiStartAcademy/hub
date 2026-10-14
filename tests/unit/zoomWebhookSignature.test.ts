import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyZoomWebhookSignature } from "@/lib/zoomWebhookSignature";

const SECRET = "zoom-webhook-secret-for-tests";
const WRONG_SECRET = "wrong-secret-for-tests";
const NOW_MS = 1_700_000_000_000;
const RAW_BODY = JSON.stringify({
  event: "recording.completed",
  payload: {
    object: {
      id: 123456789,
    },
  },
});

function signZoomWebhook(
  rawBody: string,
  timestamp: string,
  secret: string
): string {
  const message = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac("sha256", secret).update(message).digest("hex")}`;
}

function expectVerificationFailure(
  result: ReturnType<typeof verifyZoomWebhookSignature>
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason.length).toBeGreaterThan(0);
  }
}

describe("verifyZoomWebhookSignature", () => {
  it("passes with a valid signature", () => {
    const timestamp = `${Math.floor(NOW_MS / 1000)}`;
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: signZoomWebhook(RAW_BODY, timestamp, SECRET),
      timestamp,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ ok: true });
  });

  it("fails when the body is tampered with", () => {
    const timestamp = `${Math.floor(NOW_MS / 1000)}`;
    const result = verifyZoomWebhookSignature({
      rawBody: `${RAW_BODY} `,
      signature: signZoomWebhook(RAW_BODY, timestamp, SECRET),
      timestamp,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expectVerificationFailure(result);
  });

  it("fails when the secret is wrong", () => {
    const timestamp = `${Math.floor(NOW_MS / 1000)}`;
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: signZoomWebhook(RAW_BODY, timestamp, SECRET),
      timestamp,
      secret: WRONG_SECRET,
      nowMs: NOW_MS,
    });

    expectVerificationFailure(result);
  });

  it("fails when the signature header is missing", () => {
    const timestamp = `${Math.floor(NOW_MS / 1000)}`;
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: null,
      timestamp,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expectVerificationFailure(result);
  });

  it("fails when the timestamp header is missing", () => {
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: signZoomWebhook(RAW_BODY, `${Math.floor(NOW_MS / 1000)}`, SECRET),
      timestamp: null,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expectVerificationFailure(result);
  });

  it("fails when the timestamp is not numeric", () => {
    const timestamp = "not-a-number";
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: signZoomWebhook(RAW_BODY, timestamp, SECRET),
      timestamp,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expectVerificationFailure(result);
  });

  it("fails when the timestamp is six minutes old", () => {
    const timestamp = `${Math.floor((NOW_MS - 6 * 60 * 1000) / 1000)}`;
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: signZoomWebhook(RAW_BODY, timestamp, SECRET),
      timestamp,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expectVerificationFailure(result);
  });

  it("passes when the timestamp is four minutes old", () => {
    const timestamp = `${Math.floor((NOW_MS - 4 * 60 * 1000) / 1000)}`;
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: signZoomWebhook(RAW_BODY, timestamp, SECRET),
      timestamp,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expect(result).toEqual({ ok: true });
  });

  it("fails when the timestamp is six minutes in the future", () => {
    const timestamp = `${Math.floor((NOW_MS + 6 * 60 * 1000) / 1000)}`;
    const result = verifyZoomWebhookSignature({
      rawBody: RAW_BODY,
      signature: signZoomWebhook(RAW_BODY, timestamp, SECRET),
      timestamp,
      secret: SECRET,
      nowMs: NOW_MS,
    });

    expectVerificationFailure(result);
  });

  it("fails cleanly when the signature length differs", () => {
    const timestamp = `${Math.floor(NOW_MS / 1000)}`;
    const runVerification = () =>
      verifyZoomWebhookSignature({
        rawBody: RAW_BODY,
        signature: "v0=short",
        timestamp,
        secret: SECRET,
        nowMs: NOW_MS,
      });

    expect(runVerification).not.toThrow();
    expectVerificationFailure(runVerification());
  });
});
