import { describe, it, expect } from "vitest";
import { STADIUMS, getStadium, isIndoorStadium } from "@/lib/stadiums";
import { NFL_TEAMS } from "@/lib/nfl-teams";

// The 11 teams that play under a dome / fixed roof / retractable roof. Note
// this is deliberately validated as an exact set — the ticket wrongly listed
// SEA as retractable, so we lock in that SEA is NOT here.
const EXPECTED_INDOOR = ["ARI", "ATL", "DAL", "DET", "HOU", "IND", "LV", "LAC", "LAR", "MIN", "NO"].sort();

describe("STADIUMS", () => {
  it("has an entry for all 32 NFL teams", () => {
    for (const team of NFL_TEAMS) {
      expect(STADIUMS[team.abbr], `missing stadium for ${team.abbr}`).toBeDefined();
    }
    expect(Object.keys(STADIUMS)).toHaveLength(NFL_TEAMS.length);
  });

  it("has plausible US lat/lon for every stadium", () => {
    for (const s of Object.values(STADIUMS)) {
      expect(s.lat, s.team).toBeGreaterThan(24); // south FL
      expect(s.lat, s.team).toBeLessThan(49); // north border
      expect(s.lon, s.team).toBeGreaterThan(-125); // west coast
      expect(s.lon, s.team).toBeLessThan(-66); // east coast
    }
  });

  it("marks exactly the expected teams indoor", () => {
    const indoor = Object.values(STADIUMS)
      .filter((s) => s.indoor)
      .map((s) => s.team)
      .sort();
    expect(indoor).toEqual(EXPECTED_INDOOR);
  });

  it("keeps SEA (Lumen Field) outdoor — the ticket's 'retractable' was wrong", () => {
    expect(isIndoorStadium("SEA")).toBe(false);
  });

  it("keeps MetLife (NYG/NYJ) outdoor", () => {
    expect(isIndoorStadium("NYG")).toBe(false);
    expect(isIndoorStadium("NYJ")).toBe(false);
  });

  it("shares SoFi coordinates between the Rams and Chargers", () => {
    expect(STADIUMS.LAR.lat).toBe(STADIUMS.LAC.lat);
    expect(STADIUMS.LAR.lon).toBe(STADIUMS.LAC.lon);
  });
});

describe("getStadium / isIndoorStadium", () => {
  it("returns the stadium for a known team", () => {
    expect(getStadium("GB")?.name).toBe("Lambeau Field");
  });

  it("returns null for an unknown abbreviation", () => {
    expect(getStadium("XYZ")).toBeNull();
    expect(isIndoorStadium("XYZ")).toBe(false);
  });
});
