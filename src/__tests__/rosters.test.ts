import { describe, it, expect } from "vitest";
import {
  rostersLocked,
  computeRolloverMemberships,
  buildTeamStandings,
  type StandingPlayer,
} from "@/lib/rosters";

describe("rostersLocked", () => {
  const now = new Date("2025-09-10T18:00:00Z");

  it("is unlocked before the first kickoff", () => {
    expect(rostersLocked(new Date("2025-09-11T00:00:00Z"), now)).toBe(false);
  });

  it("is locked at or after the first kickoff", () => {
    expect(rostersLocked(new Date("2025-09-10T18:00:00Z"), now)).toBe(true); // exactly at kickoff
    expect(rostersLocked(new Date("2025-09-07T17:00:00Z"), now)).toBe(true);
  });

  it("is unlocked when the season has no games scheduled yet", () => {
    expect(rostersLocked(null, now)).toBe(false);
  });
});

describe("computeRolloverMemberships", () => {
  const prior = [
    { userId: "u1", teamId: "tA" },
    { userId: "u2", teamId: "tA" },
    { userId: "u3", teamId: "tB" },
  ];

  it("clones every prior membership when all teams and users still exist", () => {
    const rollover = computeRolloverMemberships(
      prior,
      new Set(["tA", "tB"]),
      new Set(["u1", "u2", "u3"])
    );
    expect(rollover).toEqual(prior);
  });

  it("skips a membership whose team was deleted", () => {
    const rollover = computeRolloverMemberships(
      prior,
      new Set(["tA"]), // tB gone
      new Set(["u1", "u2", "u3"])
    );
    expect(rollover).toEqual([
      { userId: "u1", teamId: "tA" },
      { userId: "u2", teamId: "tA" },
    ]);
  });

  it("skips a membership whose user is gone", () => {
    const rollover = computeRolloverMemberships(
      prior,
      new Set(["tA", "tB"]),
      new Set(["u1", "u3"]) // u2 gone
    );
    expect(rollover).toEqual([
      { userId: "u1", teamId: "tA" },
      { userId: "u3", teamId: "tB" },
    ]);
  });

  it("returns empty when there is no prior season to copy", () => {
    expect(computeRolloverMemberships([], new Set(), new Set())).toEqual([]);
  });
});

describe("buildTeamStandings", () => {
  const players: StandingPlayer[] = [
    { id: "u1", displayName: "Ann", points: 10, winPct: 0.8 },
    { id: "u2", displayName: "Bob", points: 6, winPct: 0.6 },
    { id: "u3", displayName: "Cy", points: 4, winPct: 0.4 },
    { id: "u4", displayName: "Di", points: 2, winPct: 0.2 },
  ];

  it("groups players by the season's membership map and averages win%", () => {
    const map = new Map([
      ["u1", "Sharks"],
      ["u2", "Sharks"],
      ["u3", "Jets"],
    ]);
    const teams = buildTeamStandings(players, map);
    expect(teams.map((t) => t.name)).toEqual(["Sharks", "Jets"]); // sorted by avgWinPct desc
    const sharks = teams.find((t) => t.name === "Sharks")!;
    expect(sharks.playerCount).toBe(2);
    expect(sharks.avgWinPct).toBeCloseTo(0.7);
    expect(sharks.totalPoints).toBe(16);
  });

  it("excludes teamless players (no map entry) from the trophy", () => {
    const map = new Map([["u1", "Sharks"]]);
    const teams = buildTeamStandings(players, map);
    expect(teams).toHaveLength(1);
    expect(teams[0].players.map((p) => p.displayName)).toEqual(["Ann"]);
    // u2/u3/u4 are teamless this season — absent from the trophy entirely.
  });

  it("gives each season its own roster: same players, different maps → different teams", () => {
    // Cross-season roster change (#120): u1 is on Sharks one season, Jets the next.
    const seasonA = new Map([
      ["u1", "Sharks"],
      ["u2", "Sharks"],
    ]);
    const seasonB = new Map([
      ["u1", "Jets"],
      ["u2", "Sharks"],
    ]);

    const a = buildTeamStandings(players, seasonA);
    expect(a.find((t) => t.name === "Sharks")!.players.map((p) => p.displayName).sort()).toEqual(["Ann", "Bob"]);
    expect(a.find((t) => t.name === "Jets")).toBeUndefined();

    const b = buildTeamStandings(players, seasonB);
    expect(b.find((t) => t.name === "Jets")!.players.map((p) => p.displayName)).toEqual(["Ann"]);
    expect(b.find((t) => t.name === "Sharks")!.players.map((p) => p.displayName)).toEqual(["Bob"]);
  });
});
