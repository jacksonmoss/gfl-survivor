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
  it("returns seasonType 2 for regular season", () => {
    const { seasonType, espnWeek } = getESPNWeekParams(1, false);
    expect(seasonType).toBe(2);
    expect(espnWeek).toBe(1);
  });

  it("returns correct week number for regular season", () => {
    expect(getESPNWeekParams(18, false).espnWeek).toBe(18);
    expect(getESPNWeekParams(5, false).espnWeek).toBe(5);
  });

  it("returns seasonType 3 for playoffs", () => {
    const { seasonType } = getESPNWeekParams(19, true);
    expect(seasonType).toBe(3);
  });

  it("maps playoff weeks correctly", () => {
    expect(getESPNWeekParams(19, true).espnWeek).toBe(1); // Wild Card
    expect(getESPNWeekParams(20, true).espnWeek).toBe(2); // Divisional
    expect(getESPNWeekParams(21, true).espnWeek).toBe(3); // Conference
    expect(getESPNWeekParams(22, true).espnWeek).toBe(5); // Super Bowl
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
