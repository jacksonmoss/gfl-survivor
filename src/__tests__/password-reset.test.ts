import { describe, it, expect } from "vitest";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  isResetTokenExpired,
  generateTempPassword,
  RESET_TOKEN_TTL_MS,
} from "@/lib/password-reset";

describe("reset tokens", () => {
  it("generates a 64-char hex token", () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique tokens", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).not.toBe(b);
  });

  it("hashes deterministically and differs from the raw token", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
    expect(hashResetToken(token)).not.toBe(token);
    expect(hashResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different tokens hash differently", () => {
    expect(hashResetToken("a")).not.toBe(hashResetToken("b"));
  });
});

describe("token expiry", () => {
  it("sets expiry one TTL into the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = resetTokenExpiry(now);
    expect(expiry.getTime()).toBe(now.getTime() + RESET_TOKEN_TTL_MS);
  });

  it("is not expired before the deadline", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = resetTokenExpiry(now);
    const justBefore = new Date(expiry.getTime() - 1000);
    expect(isResetTokenExpired(expiry, justBefore)).toBe(false);
  });

  it("is expired after the deadline", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const expiry = resetTokenExpiry(now);
    const justAfter = new Date(expiry.getTime() + 1000);
    expect(isResetTokenExpired(expiry, justAfter)).toBe(true);
  });
});

describe("temp passwords", () => {
  it("generates the requested length", () => {
    expect(generateTempPassword().length).toBe(12);
    expect(generateTempPassword(8).length).toBe(8);
  });

  it("avoids ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword(20)).not.toMatch(/[0O1lI]/);
    }
  });

  it("generates unique passwords", () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
