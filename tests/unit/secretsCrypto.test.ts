import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "crypto";

// A valid 32-byte key, base64-encoded, for the whole suite.
const KEY_B64 = randomBytes(32).toString("base64");

let encryptSecret: typeof import("@/lib/secretsCrypto").encryptSecret;
let decryptSecret: typeof import("@/lib/secretsCrypto").decryptSecret;
let secretsCryptoReady: typeof import("@/lib/secretsCrypto").secretsCryptoReady;
let last4: typeof import("@/lib/secretsCrypto").last4;

const originalKey = process.env.SETTINGS_ENC_KEY;

beforeAll(async () => {
  process.env.SETTINGS_ENC_KEY = KEY_B64;
  const mod = await import("@/lib/secretsCrypto");
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  secretsCryptoReady = mod.secretsCryptoReady;
  last4 = mod.last4;
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.SETTINGS_ENC_KEY;
  else process.env.SETTINGS_ENC_KEY = originalKey;
});

describe("secretsCrypto", () => {
  it("round-trips a value through encrypt → decrypt", () => {
    const plaintext = "sk-live-abc123-super-secret-token";
    const enc = encryptSecret(plaintext);
    expect(enc.valueEncrypted).not.toContain(plaintext);
    expect(decryptSecret(enc)).toBe(plaintext);
  });

  it("produces a fresh iv per encryption (no deterministic ciphertext)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a.iv).not.toBe(b.iv);
    expect(a.valueEncrypted).not.toBe(b.valueEncrypted);
  });

  it("fails to decrypt a tampered ciphertext (GCM auth)", () => {
    const enc = encryptSecret("integrity-matters");
    const tampered = { ...enc, valueEncrypted: Buffer.from("garbage").toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("reports ready when the key is valid", () => {
    expect(secretsCryptoReady()).toBe(true);
  });

  it("fails closed when the key is missing", () => {
    process.env.SETTINGS_ENC_KEY = "";
    expect(secretsCryptoReady()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/SETTINGS_ENC_KEY/);
    process.env.SETTINGS_ENC_KEY = KEY_B64;
  });

  it("fails closed when the key is the wrong length", () => {
    process.env.SETTINGS_ENC_KEY = Buffer.from("too-short").toString("base64");
    expect(secretsCryptoReady()).toBe(false);
    process.env.SETTINGS_ENC_KEY = KEY_B64;
  });

  it("last4 exposes only the tail, safely for short values", () => {
    expect(last4("abcdefgh")).toBe("efgh");
    expect(last4("ab")).toBe("ab");
  });
});
