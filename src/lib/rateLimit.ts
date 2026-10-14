// src/lib/rateLimit.ts
//
// Minimal in-process fixed-window rate limiter, keyed by an arbitrary string
// (caller composes IP + email, IP alone, etc). Does NOT survive multiple
// instances or restarts — every process/pod keeps its own counters, so under
// horizontal scaling an attacker gets `limit` attempts per instance, not
// globally. If the hub ever runs more than one instance, move this to Redis
// (e.g. Upstash) before relying on it for anything security-sensitive.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Periodic sweep so `buckets` doesn't grow unbounded with one-off keys
// (e.g. per-IP) that are never checked again after their window expires.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = Date.now();

function sweepExpired(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  limited: boolean;
  /** Seconds until the caller may retry. Only meaningful when `limited` is true. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window limiter: allows up to `limit` calls per `windowMs` for a given key.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { limited: true, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  return { limited: false, retryAfterSeconds: 0 };
}
