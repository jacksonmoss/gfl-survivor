import { describe, it, expect } from "vitest";
import { mapTeamAbbr, getESPNWeekParams, buildESPNUrl } from "@/lib/espn";

describe("mapTeamAbbr", () => {
  it("maps WSH to WAS", () => {
    expect(mapTeamAbbr("WSH")).toBe("WAS");
  });

  it("passes through standard abbreviations unchanged", () => {
    expect(mapTeamAbbr("KC")).toBe("KC");
    expect(mapTeamAbbr("BUF")).toBe("BUF");
    expect(mapTeamAbbr("SF")).toBe("SF");
    expect(mapTeamAbbr("JAX")).toBe("JAX");
    expect(mapTeamAbbr("LAR")).toBe("LAR");
  });
});

describe("getESPNWeekParams", () => {
  // Standard 18-game regular season → playoffs start at week 19.
  it("returns seasonType 2 for regular season", () => {
    const { seasonType, espnWeek } = getESPNWeekParams(1, false, 19);
    expect(seasonType).toBe(2);
    expect(espnWeek).toBe(1);
  });

  it("returns correct week number for regular season", () => {
    expect(getESPNWeekParams(18, false, 19).espnWeek).toBe(18);
    expect(getESPNWeekParams(5, false, 19).espnWeek).toBe(5);
  });

  it("returns seasonType 3 for playoffs", () => {
    const { seasonType } = getESPNWeekParams(19, true, 19);
    expect(seasonType).toBe(3);
  });

  it("maps playoff weeks correctly (18-game season, playoffs at 19-22)", () => {
    expect(getESPNWeekParams(19, true, 19).espnWeek).toBe(1); // Wild Card
    expect(getESPNWeekParams(20, true, 19).espnWeek).toBe(2); // Divisional
    expect(getESPNWeekParams(21, true, 19).espnWeek).toBe(3); // Conference
    expect(getESPNWeekParams(22, true, 19).espnWeek).toBe(5); // Super Bowl (ESPN skips 4)
  });

  // The playoff mapping is driven by the round index off firstPlayoffWeek, not a
  // hardcoded 18/22 — so a differently-sized regular season still maps correctly.
  it("maps playoff rounds off firstPlayoffWeek, not a fixed offset (19-game season)", () => {
    // Regular season grows to 19 weeks → playoffs at 20-23.
    expect(getESPNWeekParams(19, false, 20).espnWeek).toBe(19); // still regular season
    expect(getESPNWeekParams(20, true, 20).espnWeek).toBe(1); // Wild Card
    expect(getESPNWeekParams(21, true, 20).espnWeek).toBe(2); // Divisional
    expect(getESPNWeekParams(22, true, 20).espnWeek).toBe(3); // Conference
    expect(getESPNWeekParams(23, true, 20).espnWeek).toBe(5); // Super Bowl
    expect(getESPNWeekParams(20, true, 20).seasonType).toBe(3);
  });
});

describe("buildESPNUrl", () => {
  it("builds correct URL for regular season", () => {
    const url = buildESPNUrl(2025, 2, 1);
    expect(url).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=1&dates=2025"
    );
  });

  it("builds correct URL for playoffs", () => {
    const url = buildESPNUrl(2025, 3, 5);
    expect(url).toContain("seasontype=3");
    expect(url).toContain("week=5");
    expect(url).toContain("dates=2025");
  });
});
