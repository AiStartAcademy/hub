import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { getAisaSignatureDataUri } = await import("@/lib/aisaSignature");

describe("getAisaSignatureDataUri", () => {
  it("returns an inlined PNG data URI", () => {
    const dataUri = getAisaSignatureDataUri();

    expect(dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUri.length).toBeGreaterThan("data:image/png;base64,".length);
  });
});
