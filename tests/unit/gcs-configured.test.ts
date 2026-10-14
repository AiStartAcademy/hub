import { describe, expect, test } from "bun:test";

import { isGcsConfigured } from "@/lib/gcs";

describe("isGcsConfigured", () => {
  test("is false when bucket or service-account credentials are missing", () => {
    expect(isGcsConfigured({})).toBe(false);
    expect(isGcsConfigured({ GCS_BUCKET_NAME: "b", GCS_CLIENT_EMAIL: "sa@x" })).toBe(false);
    expect(isGcsConfigured({ GCS_BUCKET_NAME: "", GCS_CLIENT_EMAIL: "sa@x", GCS_PRIVATE_KEY: "k" })).toBe(false);
  });

  test("is true when bucket, client email and private key are all set", () => {
    expect(isGcsConfigured({ GCS_BUCKET_NAME: "b", GCS_CLIENT_EMAIL: "sa@x", GCS_PRIVATE_KEY: "k" })).toBe(true);
  });
});
