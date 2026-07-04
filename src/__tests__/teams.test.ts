import { describe, it, expect } from "vitest";
import { validateTeamName } from "@/lib/teams";

describe("validateTeamName", () => {
  it("accepts a fresh name when none exists", () => {
    expect(validateTeamName("The Dawgs", null)).toEqual({ ok: true, name: "The Dawgs" });
  });

  it("trims surrounding whitespace", () => {
    expect(validateTeamName("  Trimmed Name  ", null)).toEqual({ ok: true, name: "Trimmed Name" });
  });

  it("rejects an empty name", () => {
    expect(validateTeamName("", null)).toEqual({ ok: false, error: "Team name is required" });
  });

  it("rejects a whitespace-only name", () => {
    expect(validateTeamName("   ", null)).toEqual({ ok: false, error: "Team name is required" });
  });

  it("rejects undefined/null input", () => {
    expect(validateTeamName(undefined, null)).toEqual({ ok: false, error: "Team name is required" });
    expect(validateTeamName(null, null)).toEqual({ ok: false, error: "Team name is required" });
  });

  it("rejects a name held by another team (create: no selfId)", () => {
    expect(validateTeamName("The Dawgs", { id: "team-1" })).toEqual({
      ok: false,
      error: "Team name already taken",
    });
  });

  it("rejects a name held by a different team when renaming", () => {
    expect(validateTeamName("The Dawgs", { id: "team-1" }, "team-2")).toEqual({
      ok: false,
      error: "Team name already taken",
    });
  });

  it("allows renaming a team to its own current name (self is not a collision)", () => {
    expect(validateTeamName("The Dawgs", { id: "team-1" }, "team-1")).toEqual({
      ok: true,
      name: "The Dawgs",
    });
  });

  it("checks blank before collision", () => {
    // even if a team somehow matched, an empty name fails on the required check first
    expect(validateTeamName("  ", { id: "team-1" })).toEqual({
      ok: false,
      error: "Team name is required",
    });
  });
});
