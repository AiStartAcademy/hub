// AES-256-GCM encryption for the integrations secret registry.
// See docs/features/INTEGRATIONS.md. The master key lives in env (SETTINGS_ENC_KEY) by
// necessity — you can't store the decryptor inside what it decrypts. Fails closed if the
// key is missing or the wrong length, so misconfiguration never silently downgrades to
// plaintext or wrong-key behavior.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type EncryptedSecret = {
  valueEncrypted: string; // base64 ciphertext
  iv: string; // base64
  authTag: string; // base64
};

function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENC_KEY;
  if (!raw) {
    throw new Error("SETTINGS_ENC_KEY is not set — integrations secrets are unavailable");
  }
  // Accept base64 (preferred) or hex; must decode to exactly 32 bytes.
  let key: Buffer;
  try {
    key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  } catch {
    throw new Error("SETTINGS_ENC_KEY is malformed (expected base64 or 64-char hex)");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`SETTINGS_ENC_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    valueEncrypted: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(rec: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(rec.iv, "base64"));
  decipher.setAuthTag(Buffer.from(rec.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(rec.valueEncrypted, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Whether crypto is usable — used by health checks and the accessor's fail-closed path. */
export function secretsCryptoReady(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

export function last4(value: string): string {
  return value.length <= 4 ? value : value.slice(-4);
}
