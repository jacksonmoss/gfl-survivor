// In-memory fixed-window rate limiter. State lives in the process, so it resets
// on restart and is NOT shared across replicas — a basic mitigation for a
// single-instance deployment (issue #5), not a full solution. Swap the store for
// Redis if the app is ever scaled horizontally.

export interface RateLimitConfig {
  /** Max requests allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  /** True when the request should be rejected. */
  limited: boolean;
  /** Requests remaining in the current window (0 when limited). */
  remaining: number;
  /** Seconds until the window resets — send as the `Retry-After` header. */
  retryAfterSeconds: number;
}

// Preset limits for the sensitive auth endpoints (issue #5 acceptance criteria).
export const AUTH_RATE_LIMITS = {
  forgotPassword: { max: 5, windowMs: 15 * 60_000 },
  resetPassword: { max: 10, windowMs: 60 * 60_000 },
  login: { max: 10, windowMs: 15 * 60_000 },
} satisfies Record<string, RateLimitConfig>;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const PRUNE_INTERVAL_MS = 60_000;
let lastPrune = 0;

// Drop expired buckets occasionally so the map doesn't grow without bound as new
// client IPs appear. Cheap: sweeps at most once per PRUNE_INTERVAL_MS.
function prune(now: number) {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  { max, windowMs }: RateLimitConfig,
  now: number = Date.now()
): RateLimitResult {
  prune(now);

  const bucket = buckets.get(key);

  // No bucket yet, or the previous window has elapsed — start a fresh window.
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: max - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= max) {
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { limited: false, remaining: max - bucket.count, retryAfterSeconds: 0 };
}

// Read-only check: reports whether `key` is currently over its limit without
// consuming any budget. Used by the login flow (issue #46), where `authorize`
// (src/lib/auth.ts) counts *failed* attempts only — so it peeks to reject a
// locked-out caller before doing any DB/bcrypt work, without a peek itself
// counting as an attempt.
export function peekRateLimit(
  key: string,
  { max }: RateLimitConfig,
  now: number = Date.now()
): RateLimitResult {
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    return { limited: false, remaining: max, retryAfterSeconds: 0 };
  }

  if (bucket.count >= max) {
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  return { limited: false, remaining: max - bucket.count, retryAfterSeconds: 0 };
}

// Clears a key's window. Called on a successful login so a user who fat-fingers
// their password a few times isn't left one mistake from a lockout, and so a
// legitimate login from a shared/NAT'd IP drains attempts accrued by others.
export function resetRateLimit(key: string) {
  buckets.delete(key);
}

// Test helper — clears all state between test cases.
export function __resetRateLimiter() {
  buckets.clear();
  lastPrune = 0;
}

// Extracts the client IP from proxy headers. Accepts both a `Headers` instance
// (route handlers / proxy) and a plain header object (e.g. NextAuth's authorize
// req). Behind nginx the first X-Forwarded-For entry is the real client — see
// deploy/nginx.conf, which sets X-Forwarded-For and X-Real-IP.
export function getClientIp(
  headers:
    | Headers
    | Record<string, string | string[] | undefined>
    | undefined
    | null
): string {
  if (!headers) return "unknown";

  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const value = (headers as Record<string, string | string[] | undefined>)[
      name
    ];
    return Array.isArray(value) ? value[0] : value;
  };

  const forwarded = get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const realIp = get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}
