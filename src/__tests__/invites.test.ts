import { describe, it, expect } from "vitest";
import {
  formatLeagueCode,
  randomCodeSuffix,
  generateLeagueCode,
  checkInviteUsable,
  normalizeMaxUses,
  type InviteState,
} from "@/lib/invites";

describe("league code generation", () => {
  it("formats a human-friendly code", () => {
    expect(formatLeagueCode(2026, "A7QK")).toBe("GFL-2026-A7QK");
  });

  it("produces a suffix of the requested length from the unambiguous alphabet", () => {
    const suffix = randomCodeSuffix(4, () => 0);
    expect(suffix).toHaveLength(4);
    // rand() = 0 always picks the first alphabet char ('A')
    expect(suffix).toBe("AAAA");
    expect(suffix).not.toMatch(/[01OIL]/);
  });

  it("generateLeagueCode embeds the year and a 4-char suffix", () => {
    const code = generateLeagueCode(2026, () => 0.99);
    expect(code).toMatch(/^GFL-2026-[A-Z2-9]{4}$/);
  });
});

describe("normalizeMaxUses", () => {
  it("treats null/empty/invalid as unlimited (null)", () => {
    expect(normalizeMaxUses(null)).toBeNull();
    expect(normalizeMaxUses("")).toBeNull();
    expect(normalizeMaxUses(undefined)).toBeNull();
    expect(normalizeMaxUses(0)).toBeNull();
    expect(normalizeMaxUses(-3)).toBeNull();
    expect(normalizeMaxUses("abc")).toBeNull();
  });

  it("coerces positive numbers/strings to a floored integer", () => {
    expect(normalizeMaxUses(5)).toBe(5);
    expect(normalizeMaxUses("12")).toBe(12);
    expect(normalizeMaxUses(3.7)).toBe(3);
  });
});

describe("checkInviteUsable", () => {
  const base: InviteState = { multiUse: false, disabled: false, expiresAt: null, maxUses: null };
  const now = new Date("2026-08-01T00:00:00Z");

  it("allows an unused single-use code", () => {
    expect(checkInviteUsable(base, 0, now)).toEqual({ ok: true });
  });

  it("rejects a consumed single-use code", () => {
    expect(checkInviteUsable(base, 1, now)).toEqual({ ok: false, error: "Invite code already used" });
  });

  it("allows a multi-use code repeatedly", () => {
    const m = { ...base, multiUse: true };
    expect(checkInviteUsable(m, 0, now)).toEqual({ ok: true });
    expect(checkInviteUsable(m, 50, now)).toEqual({ ok: true });
  });

  it("enforces a multi-use cap", () => {
    const m = { ...base, multiUse: true, maxUses: 3 };
    expect(checkInviteUsable(m, 2, now)).toEqual({ ok: true });
    expect(checkInviteUsable(m, 3, now)).toEqual({
      ok: false,
      error: "This invite link has reached its limit",
    });
  });

  it("rejects a disabled code (single or multi-use)", () => {
    expect(checkInviteUsable({ ...base, disabled: true }, 0, now).ok).toBe(false);
    expect(checkInviteUsable({ ...base, multiUse: true, disabled: true }, 0, now)).toEqual({
      ok: false,
      error: "This invite link has been disabled",
    });
  });

  it("rejects an expired code", () => {
    const expired = { ...base, multiUse: true, expiresAt: new Date("2026-07-01T00:00:00Z") };
    expect(checkInviteUsable(expired, 0, now)).toEqual({ ok: false, error: "Invite code has expired" });
  });

  it("checks disabled before expiry before cap", () => {
    // disabled wins even if also expired and over cap
    const invite = {
      multiUse: true,
      disabled: true,
      expiresAt: new Date("2026-07-01T00:00:00Z"),
      maxUses: 1,
    };
    expect(checkInviteUsable(invite, 5, now)).toEqual({
      ok: false,
      error: "This invite link has been disabled",
    });
  });
});
