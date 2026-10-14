// Central accessor for managed secrets/config. Resolution order:
//   DB Secret (decrypt if secret kind)  →  process.env[key]  →  undefined
// This lets call sites migrate off process.env gradually; env remains the bootstrap floor.
// See docs/features/INTEGRATIONS.md.

import prisma from "@/lib/prisma";
import { decryptSecret } from "@/lib/secretsCrypto";

const CACHE_TTL_MS = 30_000;
type CacheEntry = { value: string | undefined; expires: number };
const cache = new Map<string, CacheEntry>();

/**
 * Resolve a managed key. Returns the DB value (decrypted for secret kind) if present,
 * else the process.env value, else undefined. Never throws on a missing key — only on a
 * genuinely corrupt/undecryptable secret record, which must not be silently swallowed.
 */
export async function getSecret(key: string): Promise<string | undefined> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value: string | undefined;
  const rec = await prisma.secret.findUnique({ where: { key } });
  if (rec) {
    if (rec.kind === "config") {
      value = rec.valuePlain ?? undefined;
    } else if (rec.valueEncrypted && rec.iv && rec.authTag) {
      value = decryptSecret({
        valueEncrypted: rec.valueEncrypted,
        iv: rec.iv,
        authTag: rec.authTag,
      });
    }
  }
  if (value === undefined) value = process.env[key];

  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Bust the in-process cache for one key (call after a save/delete). */
export function bustSecretCache(key: string): void {
  cache.delete(key);
}
