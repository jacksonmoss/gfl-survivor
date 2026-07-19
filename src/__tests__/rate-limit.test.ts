import { describe, it, expect, beforeEach } from "vitest";
import {
  rateLimit,
  peekRateLimit,
  resetRateLimit,
  getClientIp,
  __resetRateLimiter,
  AUTH_RATE_LIMITS,
} from "@/lib/rate-limit";

const config = { max: 3, windowMs: 10_000 };

beforeEach(() => {
  __resetRateLimiter();
});

describe("rateLimit", () => {
  it("allows requests up to the max within a window", () => {
    const t = 1_000;
    expect(rateLimit("ip", config, t).limited).toBe(false);
    expect(rateLimit("ip", config, t).limited).toBe(false);
    expect(rateLimit("ip", config, t).limited).toBe(false);
  });

  it("blocks the request after the max is reached", () => {
    const t = 1_000;
    rateLimit("ip", config, t);
    rateLimit("ip", config, t);
    rateLimit("ip", config, t);
    const result = rateLimit("ip", config, t);
    expect(result.limited).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("decrements remaining as requests are made", () => {
    const t = 1_000;
    expect(rateLimit("ip", config, t).remaining).toBe(2);
    expect(rateLimit("ip", config, t).remaining).toBe(1);
    expect(rateLimit("ip", config, t).remaining).toBe(0);
  });

  it("reports seconds until the window resets when limited", () => {
    const t = 1_000;
    for (let i = 0; i < config.max; i++) rateLimit("ip", config, t);
    // Called 4s in; window is 10s, so ~6s remain.
    const result = rateLimit("ip", config, t + 4_000);
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBe(6);
  });

  it("starts a fresh window once the previous one elapses", () => {
    const t = 1_000;
    for (let i = 0; i < config.max; i++) rateLimit("ip", config, t);
    expect(rateLimit("ip", config, t).limited).toBe(true);
    // Past the window — allowed again.
    const result = rateLimit("ip", config, t + config.windowMs);
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(config.max - 1);
  });

  it("tracks separate keys independently", () => {
    const t = 1_000;
    for (let i = 0; i < config.max; i++) rateLimit("a", config, t);
    expect(rateLimit("a", config, t).limited).toBe(true);
    expect(rateLimit("b", config, t).limited).toBe(false);
  });

  it("exposes the documented auth limits", () => {
    expect(AUTH_RATE_LIMITS.forgotPassword).toEqual({
      max: 5,
      windowMs: 15 * 60_000,
    });
    expect(AUTH_RATE_LIMITS.resetPassword).toEqual({
      max: 10,
      windowMs: 60 * 60_000,
    });
    expect(AUTH_RATE_LIMITS.login).toEqual({ max: 10, windowMs: 15 * 60_000 });
  });
});

describe("peekRateLimit", () => {
  it("does not consume budget — repeated peeks never trip the limit", () => {
    const t = 1_000;
    for (let i = 0; i < 100; i++) {
      expect(peekRateLimit("ip", config, t).limited).toBe(false);
    }
    // A fresh consume still sees the full budget.
    expect(rateLimit("ip", config, t).remaining).toBe(config.max - 1);
  });

  it("reports remaining without decrementing it", () => {
    const t = 1_000;
    rateLimit("ip", config, t); // consume 1 of 3
    expect(peekRateLimit("ip", config, t).remaining).toBe(2);
    expect(peekRateLimit("ip", config, t).remaining).toBe(2);
  });

  it("reports limited (with retry-after) once the count hits max", () => {
    const t = 1_000;
    for (let i = 0; i < config.max; i++) rateLimit("ip", config, t);
    const result = peekRateLimit("ip", config, t + 4_000);
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBe(6);
  });

  it("reports not-limited for an unknown key or an elapsed window", () => {
    const t = 1_000;
    expect(peekRateLimit("never-seen", config, t).limited).toBe(false);
    for (let i = 0; i < config.max; i++) rateLimit("ip", config, t);
    expect(peekRateLimit("ip", config, t + config.windowMs).limited).toBe(false);
  });
});

describe("resetRateLimit", () => {
  it("clears an existing window so budget is restored", () => {
    const t = 1_000;
    for (let i = 0; i < config.max; i++) rateLimit("ip", config, t);
    expect(peekRateLimit("ip", config, t).limited).toBe(true);

    resetRateLimit("ip");

    expect(peekRateLimit("ip", config, t).limited).toBe(false);
    expect(rateLimit("ip", config, t).remaining).toBe(config.max - 1);
  });

  it("is a no-op for an unknown key", () => {
    expect(() => resetRateLimit("never-seen")).not.toThrow();
  });
});

describe("getClientIp", () => {
  it("reads the first entry of X-Forwarded-For from a Headers instance", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });
    expect(getClientIp(headers)).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.4" });
    expect(getClientIp(headers)).toBe("198.51.100.4");
  });

  it("reads from a plain header object (NextAuth authorize req)", () => {
    expect(getClientIp({ "x-forwarded-for": "192.0.2.9, 10.0.0.2" })).toBe(
      "192.0.2.9"
    );
  });

  it("handles array-valued headers", () => {
    expect(getClientIp({ "x-forwarded-for": ["192.0.2.10", "10.0.0.3"] })).toBe(
      "192.0.2.10"
    );
  });

  it("returns 'unknown' when no IP headers are present", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
    expect(getClientIp(undefined)).toBe("unknown");
    expect(getClientIp(null)).toBe("unknown");
  });
});
