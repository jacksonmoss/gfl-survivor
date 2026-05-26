import { describe, it, expect } from "vitest";
import { NFL_TEAMS, getTeamName } from "@/lib/nfl-teams";

describe("NFL_TEAMS", () => {
  it("contains exactly 32 teams", () => {
    expect(NFL_TEAMS).toHaveLength(32);
  });

  it("has unique abbreviations", () => {
    const abbrs = NFL_TEAMS.map((t) => t.abbr);
    expect(new Set(abbrs).size).toBe(32);
  });

  it("every team has conference and division", () => {
    for (const team of NFL_TEAMS) {
      expect(["AFC", "NFC"]).toContain(team.conference);
      expect(["North", "South", "East", "West"]).toContain(team.division);
    }
  });

  it("has 16 teams per conference", () => {
    const afc = NFL_TEAMS.filter((t) => t.conference === "AFC");
    const nfc = NFL_TEAMS.filter((t) => t.conference === "NFC");
    expect(afc).toHaveLength(16);
    expect(nfc).toHaveLength(16);
  });
});

describe("getTeamName", () => {
  it("returns full name for known abbreviation", () => {
    expect(getTeamName("KC")).toBe("Kansas City Chiefs");
    expect(getTeamName("BUF")).toBe("Buffalo Bills");
    expect(getTeamName("SF")).toBe("San Francisco 49ers");
  });

  it("returns abbreviation for unknown team", () => {
    expect(getTeamName("XXX")).toBe("XXX");
  });
});
