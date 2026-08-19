import { describe, it, expect } from "vitest";
import {
  isDemoMode,
  teamsPlaying,
  assignRandomPicks,
  simulateScore,
  gradeDemoPick,
  shiftKickoffs,
} from "@/lib/demo";

/** Deterministic RNG stand-in: cycles a fixed sequence of [0,1) values. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** mulberry32 — same PRNG the season simulator uses, for statistical checks. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("isDemoMode", () => {
  it("is off when unset — a deploy that never mentions DEMO_MODE is never a demo", () => {
    expect(isDemoMode({})).toBe(false);
    expect(isDemoMode({ DEMO_MODE: "" })).toBe(false);
  });

  it("accepts the usual truthy spellings, case- and space-insensitively", () => {
    for (const v of ["1", "true", "TRUE", "True", " yes ", "on"]) {
      expect(isDemoMode({ DEMO_MODE: v })).toBe(true);
    }
  });

  it("treats anything else as off", () => {
    for (const v of ["0", "false", "no", "off", "maybe", "demo"]) {
      expect(isDemoMode({ DEMO_MODE: v })).toBe(false);
    }
  });
});

describe("teamsPlaying", () => {
  it("returns both sides of every game, deduplicated", () => {
    const teams = teamsPlaying([
      { homeTeam: "KC", awayTeam: "BAL" },
      { homeTeam: "BUF", awayTeam: "ARI" },
    ]);
    expect(teams.sort()).toEqual(["ARI", "BAL", "BUF", "KC"]);
  });

  it("is empty for a week with no games", () => {
    expect(teamsPlaying([])).toEqual([]);
  });
});

describe("assignRandomPicks", () => {
  const playing = ["KC", "BAL", "BUF", "ARI"];

  it("gives every user a team from this week's slate", () => {
    const picks = assignRandomPicks(
      [{ userId: "u1", usedTeams: [] }, { userId: "u2", usedTeams: [] }],
      playing,
      seq([0, 0.99]),
    );
    expect(picks).toHaveLength(2);
    for (const p of picks) expect(playing).toContain(p.team);
  });

  it("never hands back a team the user already spent this season", () => {
    // Only ARI is left for u1; the RNG points at index 0 of the *filtered* pool.
    const picks = assignRandomPicks(
      [{ userId: "u1", usedTeams: ["KC", "BAL", "BUF"] }],
      playing,
      seq([0]),
    );
    expect(picks).toEqual([{ userId: "u1", team: "ARI" }]);
  });

  it("skips a user with nothing legal left rather than forcing an illegal pick", () => {
    const picks = assignRandomPicks(
      [
        { userId: "spent", usedTeams: playing },
        { userId: "fresh", usedTeams: [] },
      ],
      playing,
      seq([0]),
    );
    expect(picks).toEqual([{ userId: "fresh", team: "KC" }]);
  });

  it("lets two users land on the same team — that's legal in survivor", () => {
    const picks = assignRandomPicks(
      [{ userId: "u1", usedTeams: [] }, { userId: "u2", usedTeams: [] }],
      playing,
      seq([0]),
    );
    expect(picks.map((p) => p.team)).toEqual(["KC", "KC"]);
  });

  it("is a no-op when the week has no games", () => {
    expect(assignRandomPicks([{ userId: "u1", usedTeams: [] }], [], seq([0]))).toEqual([]);
  });

  it("stays inside the pool across many draws", () => {
    const rng = mulberry32(42);
    const users = Array.from({ length: 200 }, (_, i) => ({ userId: `u${i}`, usedTeams: ["KC"] }));
    const picks = assignRandomPicks(users, playing, rng);
    expect(picks).toHaveLength(200);
    for (const p of picks) {
      expect(p.team).not.toBe("KC");
      expect(playing).toContain(p.team);
    }
  });
});

describe("simulateScore", () => {
  it("never produces a tie — a random PUSH mid-demo just confuses the customer", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const { homeScore, awayScore } = simulateScore(rng);
      expect(homeScore).not.toBe(awayScore);
    }
  });

  it("stays in plausible NFL territory", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const { homeScore, awayScore } = simulateScore(rng);
      for (const s of [homeScore, awayScore]) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(60);
        expect(Number.isInteger(s)).toBe(true);
      }
    }
  });

  it("lets both sides win over a run of games", () => {
    const rng = mulberry32(2026);
    let homeWins = 0;
    for (let i = 0; i < 200; i++) {
      const { homeScore, awayScore } = simulateScore(rng);
      if (homeScore > awayScore) homeWins++;
    }
    expect(homeWins).toBeGreaterThan(20);
    expect(homeWins).toBeLessThan(180);
  });

  it("is deterministic for a given RNG", () => {
    expect(simulateScore(mulberry32(5))).toEqual(simulateScore(mulberry32(5)));
  });
});

describe("gradeDemoPick", () => {
  const game = { homeTeam: "KC", awayTeam: "BAL", homeScore: 27, awayScore: 20 };

  it("scores the week's point value for a winning pick", () => {
    expect(gradeDemoPick("KC", game, 1)).toEqual({ result: "WIN", points: 1 });
  });

  it("carries playoff escalation through, because points come from the week", () => {
    expect(gradeDemoPick("KC", game, 5)).toEqual({ result: "WIN", points: 5 });
  });

  it("scores nothing for a losing pick", () => {
    expect(gradeDemoPick("BAL", game, 3)).toEqual({ result: "LOSS", points: 0 });
  });

  it("grades a level game as a PUSH for both sides", () => {
    const tie = { homeTeam: "NYJ", awayTeam: "NE", homeScore: 3, awayScore: 3 };
    expect(gradeDemoPick("NYJ", tie, 1)).toEqual({ result: "PUSH", points: 0 });
    expect(gradeDemoPick("NE", tie, 1)).toEqual({ result: "PUSH", points: 0 });
  });

  it("returns null when the team isn't in this game, leaving the pick alone", () => {
    expect(gradeDemoPick("DEN", game, 1)).toBeNull();
  });

  it("returns null for an unplayed game", () => {
    expect(gradeDemoPick("KC", { ...game, homeScore: null, awayScore: null }, 1)).toBeNull();
  });
});

describe("shiftKickoffs", () => {
  // Thu night, two Sunday windows, Monday night — a realistic slate shape.
  const slate = [
    new Date("2026-09-10T00:20:00Z"),
    new Date("2026-09-13T17:00:00Z"),
    new Date("2026-09-13T20:25:00Z"),
    new Date("2026-09-15T00:15:00Z"),
  ];

  it("lands the last game on the target when anchored last", () => {
    const to = new Date("2026-08-18T12:00:00Z");
    const shifted = shiftKickoffs(slate, "last", to);
    expect(shifted[3].toISOString()).toBe(to.toISOString());
    expect(shifted.every((d) => d <= to)).toBe(true);
  });

  it("lands the first game on the target when anchored first", () => {
    const to = new Date("2026-08-20T12:00:00Z");
    const shifted = shiftKickoffs(slate, "first", to);
    expect(shifted[0].toISOString()).toBe(to.toISOString());
    expect(shifted.every((d) => d >= to)).toBe(true);
  });

  it("preserves the gaps between games, so Thursday/Sunday/Monday still reads right", () => {
    const shifted = shiftKickoffs(slate, "first", new Date("2026-01-01T00:00:00Z"));
    const gap = (xs: Date[], i: number) => xs[i + 1].getTime() - xs[i].getTime();
    for (let i = 0; i < slate.length - 1; i++) {
      expect(gap(shifted, i)).toBe(gap(slate, i));
    }
  });

  it("anchors on the extremes, not on input order", () => {
    const scrambled = [slate[2], slate[0], slate[3], slate[1]];
    const to = new Date("2026-05-05T00:00:00Z");
    const shifted = shiftKickoffs(scrambled, "last", to);
    // slate[3] is the latest game and sits at index 2 of the scrambled input.
    expect(shifted[2].toISOString()).toBe(to.toISOString());
  });

  it("handles an empty slate", () => {
    expect(shiftKickoffs([], "first", new Date())).toEqual([]);
  });
});
