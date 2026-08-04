import { describe, it, expect } from "vitest";
import {
  isWeekComplete,
  gameWinner,
  standingsThrough,
  computeLeadChange,
  teamPickCounts,
  gamePickCounts,
  consensusBust,
  findUpsets,
  findSweeps,
  computeStreaks,
  computeWeeklyDigest,
  computeSeasonStats,
  type StatsGame,
  type StatsWeek,
  type StatsPlayer,
  type StatsPick,
} from "@/lib/stats";

// --- fixtures --------------------------------------------------------------

const PLAYERS: StatsPlayer[] = [
  { id: "u1", displayName: "Alice" },
  { id: "u2", displayName: "Bob" },
  { id: "u3", displayName: "Cara" },
];

const NAMES = new Map(PLAYERS.map((p) => [p.id, p.displayName]));

function game(over: Partial<StatsGame> = {}): StatsGame {
  return {
    homeTeam: "KC",
    awayTeam: "BUF",
    homeScore: 28,
    awayScore: 17,
    status: "FINAL",
    spreadHome: null,
    ...over,
  };
}

function week(over: Partial<StatsWeek> = {}): StatsWeek {
  return {
    weekNumber: 1,
    label: "Week 1",
    isPlayoff: false,
    pointValue: 1,
    games: [game()],
    ...over,
  };
}

function pick(over: Partial<StatsPick> = {}): StatsPick {
  return { userId: "u1", weekNumber: 1, team: "KC", result: "WIN", points: 1, ...over };
}

// --- week completeness / winner --------------------------------------------

describe("isWeekComplete", () => {
  it("is complete only when every game is FINAL", () => {
    expect(isWeekComplete(week({ games: [game(), game({ homeTeam: "SF" })] }))).toBe(true);
    expect(
      isWeekComplete(week({ games: [game(), game({ homeTeam: "SF", status: "LIVE" })] }))
    ).toBe(false);
  });

  it("a week with no games is not complete", () => {
    // Otherwise `every` vacuously passes and an unscheduled week would publish stats.
    expect(isWeekComplete(week({ games: [] }))).toBe(false);
  });
});

describe("gameWinner", () => {
  it("returns the higher-scoring side", () => {
    expect(gameWinner(game())).toBe("KC");
    expect(gameWinner(game({ homeScore: 10, awayScore: 24 }))).toBe("BUF");
  });

  it("returns null for a tie and for an ungraded game", () => {
    expect(gameWinner(game({ homeScore: 20, awayScore: 20 }))).toBeNull();
    expect(gameWinner(game({ status: "LIVE" }))).toBeNull();
    expect(gameWinner(game({ homeScore: null, awayScore: null }))).toBeNull();
  });
});

// --- standings -------------------------------------------------------------

describe("standingsThrough", () => {
  const picks: StatsPick[] = [
    pick({ userId: "u1", weekNumber: 1, result: "WIN", points: 1 }),
    pick({ userId: "u1", weekNumber: 2, result: "LOSS", points: 0 }),
    pick({ userId: "u2", weekNumber: 1, result: "LOSS", points: 0 }),
    pick({ userId: "u2", weekNumber: 2, result: "WIN", points: 1 }),
    pick({ userId: "u3", weekNumber: 1, result: "PUSH", points: 0 }),
    pick({ userId: "u3", weekNumber: 2, result: "WIN", points: 1 }),
  ];

  it("sums only the weeks up to and including throughWeek", () => {
    const wk1 = standingsThrough(PLAYERS, picks, 1);
    expect(wk1.map((r) => [r.displayName, r.points])).toEqual([
      ["Alice", 1],
      ["Bob", 0],
      ["Cara", 0],
    ]);
  });

  it("includes players with no picks at all", () => {
    const rows = standingsThrough([...PLAYERS, { id: "u4", displayName: "Dan" }], picks, 2);
    const dan = rows.find((r) => r.displayName === "Dan")!;
    expect(dan.points).toBe(0);
    expect(dan.winPct).toBe(0);
  });

  it("excludes pushes from win% (1W/1L is 50%, 1W/1push is 100%)", () => {
    const rows = standingsThrough(PLAYERS, picks, 2);
    expect(rows.find((r) => r.displayName === "Alice")!.winPct).toBe(0.5);
    const cara = rows.find((r) => r.displayName === "Cara")!;
    expect(cara.pushes).toBe(1);
    expect(cara.winPct).toBe(1);
  });

  it("gives tied players the same rank and skips the next one", () => {
    const rows = standingsThrough(PLAYERS, picks, 2);
    // All three sit on 1 point through week 2.
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);

    const withLeader = standingsThrough(PLAYERS, [...picks, pick({ userId: "u1", weekNumber: 3, points: 5 })], 3);
    expect(withLeader.map((r) => [r.displayName, r.rank])).toEqual([
      ["Alice", 1],
      ["Bob", 2],
      ["Cara", 2],
    ]);
  });

  it("orders ties deterministically so rank deltas aren't invented", () => {
    const a = standingsThrough(PLAYERS, picks, 2).map((r) => r.userId);
    const b = standingsThrough([...PLAYERS].reverse(), picks, 2).map((r) => r.userId);
    expect(a).toEqual(b);
  });
});

// --- lead change -----------------------------------------------------------

describe("computeLeadChange", () => {
  const before = standingsThrough(PLAYERS, [pick({ userId: "u1", points: 3 })], 1);
  const after = standingsThrough(
    PLAYERS,
    [pick({ userId: "u1", points: 3 }), pick({ userId: "u2", weekNumber: 2, points: 9 })],
    2
  );

  it("returns null when there is no prior week", () => {
    expect(computeLeadChange(null, after)).toBeNull();
  });

  it("flags a new leader and reports the riser and faller", () => {
    const change = computeLeadChange(before, after)!;
    expect(change.leadChanged).toBe(true);
    expect(change.leaders).toEqual(["Bob"]);
    expect(change.previousLeaders).toEqual(["Alice"]);
    expect(change.biggestRiser).toMatchObject({ displayName: "Bob", from: 2, to: 1, delta: 1 });
    expect(change.biggestFaller).toMatchObject({ displayName: "Alice", from: 1, to: 2, delta: -1 });
  });

  it("reports no lead change when the same player stays on top", () => {
    const held = standingsThrough(
      PLAYERS,
      [pick({ userId: "u1", points: 3 }), pick({ userId: "u1", weekNumber: 2, points: 3 })],
      2
    );
    const change = computeLeadChange(before, held)!;
    expect(change.leadChanged).toBe(false);
    expect(change.leaders).toEqual(["Alice"]);
    expect(change.biggestRiser).toBeNull();
    expect(change.biggestFaller).toBeNull();
  });

  it("treats gaining a co-leader as a lead change", () => {
    const tied = standingsThrough(
      PLAYERS,
      [pick({ userId: "u1", points: 3 }), pick({ userId: "u2", weekNumber: 2, points: 3 })],
      2
    );
    const change = computeLeadChange(before, tied)!;
    expect(change.leadChanged).toBe(true);
    expect(change.leaders).toEqual(["Alice", "Bob"]);
  });
});

// --- pick distribution -----------------------------------------------------

describe("teamPickCounts / gamePickCounts / consensusBust", () => {
  const w = week({
    games: [
      game({ homeTeam: "KC", awayTeam: "BUF", homeScore: 28, awayScore: 17 }), // KC wins
      game({ homeTeam: "SF", awayTeam: "DAL", homeScore: 10, awayScore: 24 }), // DAL wins
    ],
  });
  const picks: StatsPick[] = [
    pick({ userId: "u1", team: "SF", result: "LOSS", points: 0 }),
    pick({ userId: "u2", team: "SF", result: "LOSS", points: 0 }),
    pick({ userId: "u3", team: "KC", result: "WIN", points: 1 }),
  ];

  it("counts picks per team with a share of the week", () => {
    const counts = teamPickCounts(w, picks);
    expect(counts[0]).toMatchObject({ team: "SF", count: 2, won: false });
    expect(counts[0].pct).toBeCloseTo(2 / 3);
    expect(counts[1]).toMatchObject({ team: "KC", count: 1, won: true });
  });

  it("counts both sides of a game toward that game's total", () => {
    const games = gamePickCounts(w, picks);
    expect(games[0]).toMatchObject({ homeTeam: "SF", awayTeam: "DAL", count: 2 });
    expect(games[1]).toMatchObject({ homeTeam: "KC", count: 1 });
  });

  it("omits games nobody picked", () => {
    expect(gamePickCounts(w, [picks[2]]).map((g) => g.homeTeam)).toEqual(["KC"]);
  });

  it("names the most-picked losing team as the consensus bust", () => {
    expect(consensusBust(teamPickCounts(w, picks))!.team).toBe("SF");
  });

  it("has no bust when every picked team won", () => {
    expect(consensusBust(teamPickCounts(w, [picks[2]]))).toBeNull();
  });

  it("does not treat a tie as a bust", () => {
    const tied = week({ games: [game({ homeScore: 20, awayScore: 20 })] });
    const counts = teamPickCounts(tied, [pick({ team: "KC", result: "PUSH", points: 0 })]);
    expect(counts[0].won).toBeNull();
    expect(consensusBust(counts)).toBeNull();
  });
});

// --- upsets ----------------------------------------------------------------

describe("findUpsets", () => {
  it("reports a game the underdog won, with who benefited and who got burned", () => {
    // spreadHome -7 ⇒ KC favored by 7; BUF (the away dog) wins.
    const w = week({
      games: [game({ homeScore: 17, awayScore: 24, spreadHome: -7 })],
    });
    const upsets = findUpsets(
      w,
      [
        pick({ userId: "u1", team: "BUF", result: "WIN", points: 1 }),
        pick({ userId: "u2", team: "KC", result: "LOSS", points: 0 }),
      ],
      NAMES
    );
    expect(upsets).toHaveLength(1);
    expect(upsets[0]).toMatchObject({
      winner: "BUF",
      loser: "KC",
      underdogBy: 7,
      benefited: ["Alice"],
      burned: ["Bob"],
    });
  });

  it("handles a home underdog (positive spread) winning", () => {
    const w = week({ games: [game({ homeScore: 30, awayScore: 3, spreadHome: 3.5 })] });
    expect(findUpsets(w, [], NAMES)[0]).toMatchObject({ winner: "KC", underdogBy: 3.5 });
  });

  it("is not an upset when the favorite wins", () => {
    const w = week({ games: [game({ spreadHome: -7 })] }); // KC favored, KC wins
    expect(findUpsets(w, [], NAMES)).toEqual([]);
  });

  it("skips games with no odds and pick'em games rather than guessing", () => {
    expect(findUpsets(week({ games: [game({ spreadHome: null })] }), [], NAMES)).toEqual([]);
    expect(findUpsets(week({ games: [game({ spreadHome: 0 })] }), [], NAMES)).toEqual([]);
  });

  it("skips a tied game", () => {
    const w = week({ games: [game({ homeScore: 20, awayScore: 20, spreadHome: -7 })] });
    expect(findUpsets(w, [], NAMES)).toEqual([]);
  });

  it("orders by how big the upset was", () => {
    const w = week({
      games: [
        game({ homeTeam: "KC", awayTeam: "BUF", homeScore: 17, awayScore: 24, spreadHome: -3 }),
        game({ homeTeam: "SF", awayTeam: "DAL", homeScore: 10, awayScore: 13, spreadHome: -13.5 }),
      ],
    });
    expect(findUpsets(w, [], NAMES).map((u) => u.underdogBy)).toEqual([13.5, 3]);
  });
});

// --- sweeps ----------------------------------------------------------------

describe("findSweeps", () => {
  const w = week({ games: [game()] }); // KC beats BUF

  it("calls a game perfect when everyone who picked it took the winner", () => {
    const { perfect, whiffed } = findSweeps(
      w,
      [pick({ userId: "u1" }), pick({ userId: "u2" })],
      NAMES
    );
    expect(perfect).toHaveLength(1);
    expect(perfect[0]).toMatchObject({ team: "KC", count: 2, players: ["Alice", "Bob"] });
    expect(whiffed).toEqual([]);
  });

  it("calls a game whiffed when everyone took the loser", () => {
    const { perfect, whiffed } = findSweeps(
      w,
      [
        pick({ userId: "u1", team: "BUF", result: "LOSS", points: 0 }),
        pick({ userId: "u2", team: "BUF", result: "LOSS", points: 0 }),
      ],
      NAMES
    );
    expect(perfect).toEqual([]);
    expect(whiffed[0]).toMatchObject({ team: "BUF", count: 2 });
  });

  it("is not a sweep when the picks are split", () => {
    const { perfect, whiffed } = findSweeps(
      w,
      [pick({ userId: "u1" }), pick({ userId: "u2", team: "BUF", result: "LOSS", points: 0 })],
      NAMES
    );
    expect(perfect).toEqual([]);
    expect(whiffed).toEqual([]);
  });

  it("needs more than one pick — a lone correct pick is not a sweep", () => {
    expect(findSweeps(w, [pick({ userId: "u1" })], NAMES).perfect).toEqual([]);
  });
});

// --- streaks ---------------------------------------------------------------

describe("computeStreaks", () => {
  it("counts consecutive wins and remembers the longest run", () => {
    const picks = [
      pick({ userId: "u1", weekNumber: 1, result: "WIN" }),
      pick({ userId: "u1", weekNumber: 2, result: "WIN" }),
      pick({ userId: "u1", weekNumber: 3, result: "WIN" }),
      pick({ userId: "u1", weekNumber: 4, result: "LOSS", points: 0 }),
      pick({ userId: "u1", weekNumber: 5, result: "WIN" }),
    ];
    const row = computeStreaks(PLAYERS, picks, 5).find((s) => s.userId === "u1")!;
    expect(row.current).toBe(1);
    expect(row.longest).toBe(3);
  });

  it("does not let a push break a streak, but does not extend it either", () => {
    const picks = [
      pick({ userId: "u1", weekNumber: 1, result: "WIN" }),
      pick({ userId: "u1", weekNumber: 2, result: "PUSH", points: 0 }),
      pick({ userId: "u1", weekNumber: 3, result: "WIN" }),
    ];
    const row = computeStreaks(PLAYERS, picks, 3).find((s) => s.userId === "u1")!;
    expect(row.current).toBe(2);
    expect(row.longest).toBe(2);
  });

  it("ignores ungraded picks and respects throughWeek", () => {
    const picks = [
      pick({ userId: "u1", weekNumber: 1, result: "WIN" }),
      pick({ userId: "u1", weekNumber: 2, result: "PENDING", points: 0 }),
      pick({ userId: "u1", weekNumber: 3, result: "LOSS", points: 0 }),
    ];
    expect(computeStreaks(PLAYERS, picks, 2).find((s) => s.userId === "u1")!.current).toBe(1);
    expect(computeStreaks(PLAYERS, picks, 3).find((s) => s.userId === "u1")!.current).toBe(0);
  });

  it("sorts the longest active streak first", () => {
    const picks = [
      pick({ userId: "u1", weekNumber: 1, result: "WIN" }),
      pick({ userId: "u2", weekNumber: 1, result: "WIN" }),
      pick({ userId: "u2", weekNumber: 2, result: "WIN" }),
    ];
    expect(computeStreaks(PLAYERS, picks, 2).map((s) => s.displayName)).toEqual([
      "Bob",
      "Alice",
      "Cara",
    ]);
  });
});

// --- weekly digest ---------------------------------------------------------

describe("computeWeeklyDigest", () => {
  const w2 = week({
    weekNumber: 2,
    label: "Week 2",
    games: [
      game({ homeTeam: "KC", awayTeam: "BUF", homeScore: 17, awayScore: 24, spreadHome: -7 }),
      game({ homeTeam: "SF", awayTeam: "DAL", homeScore: 31, awayScore: 7, spreadHome: -3 }),
    ],
  });
  const picks: StatsPick[] = [
    // Week 1 — Alice alone gets it right and leads.
    pick({ userId: "u1", weekNumber: 1, result: "WIN", points: 1 }),
    pick({ userId: "u2", weekNumber: 1, team: "BUF", result: "LOSS", points: 0 }),
    pick({ userId: "u3", weekNumber: 1, team: "BUF", result: "LOSS", points: 0 }),
    // Week 2 — Alice and Cara back the favorite KC and lose; Bob takes the dog.
    pick({ userId: "u1", weekNumber: 2, team: "KC", result: "LOSS", points: 0 }),
    pick({ userId: "u2", weekNumber: 2, team: "BUF", result: "WIN", points: 1 }),
    pick({ userId: "u3", weekNumber: 2, team: "KC", result: "LOSS", points: 0 }),
  ];

  const digest = computeWeeklyDigest(w2, PLAYERS, picks, 1);

  it("carries the week's identity and point value", () => {
    expect(digest).toMatchObject({ weekNumber: 2, label: "Week 2", pointValue: 1, isPlayoff: false });
    expect(digest.pickCount).toBe(3);
    expect(digest.correctCount).toBe(1);
  });

  it("reports cumulative standings and co-leaders through the week", () => {
    expect(digest.leaders.map((l) => l.displayName)).toEqual(["Alice", "Bob"]);
    expect(digest.standings.find((r) => r.displayName === "Cara")!.points).toBe(0);
  });

  it("surfaces the most-picked team, the most-picked game and the bust", () => {
    expect(digest.mostPickedTeam).toMatchObject({ team: "KC", count: 2, won: false });
    expect(digest.mostPickedGame).toMatchObject({ homeTeam: "KC", count: 3 });
    expect(digest.consensusBust!.team).toBe("KC");
  });

  it("finds the upset with the players on each side of it", () => {
    expect(digest.upsets).toHaveLength(1);
    expect(digest.upsets[0]).toMatchObject({
      winner: "BUF",
      benefited: ["Bob"],
      burned: ["Alice", "Cara"],
    });
  });

  it("counts losses and flags a leader who took one", () => {
    expect(digest.losses.total).toBe(2);
    expect(digest.losses.leadersWhoLost).toEqual(["Alice"]); // Alice led after week 1
    expect(digest.losses.streakBroken).toMatchObject({ displayName: "Alice", streak: 1 });
  });

  it("omits the lead change on the first completed week", () => {
    const first = computeWeeklyDigest(week(), PLAYERS, picks, null);
    expect(first.leadChange).toBeNull();
    expect(first.losses.streakBroken).toBeNull();
    expect(first.losses.leadersWhoLost).toEqual([]);
  });
});

// --- season rollup ---------------------------------------------------------

describe("computeSeasonStats", () => {
  const weeks: StatsWeek[] = [
    week({ weekNumber: 1, games: [game()] }),
    week({
      weekNumber: 2,
      label: "Week 2",
      games: [game({ homeTeam: "SF", awayTeam: "DAL", homeScore: 10, awayScore: 24 })],
    }),
    // In progress — excluded from every season stat and given no digest.
    week({ weekNumber: 3, label: "Week 3", games: [game({ homeTeam: "GB", status: "LIVE" })] }),
  ];
  const picks: StatsPick[] = [
    pick({ userId: "u1", weekNumber: 1, team: "KC", result: "WIN", points: 1 }),
    pick({ userId: "u2", weekNumber: 1, team: "KC", result: "WIN", points: 1 }),
    pick({ userId: "u1", weekNumber: 2, team: "SF", result: "LOSS", points: 0 }),
    pick({ userId: "u2", weekNumber: 2, team: "DAL", result: "WIN", points: 1 }),
    pick({ userId: "u1", weekNumber: 3, team: "GB", result: "PENDING", points: 0 }),
  ];

  const { stats, digests } = computeSeasonStats(weeks, PLAYERS, picks);

  it("only counts completed weeks", () => {
    expect(stats.completedWeeks).toEqual([1, 2]);
    expect(stats.totals).toMatchObject({ picks: 4, wins: 3, losses: 1, pushes: 0 });
    expect(stats.totals.winPct).toBe(0.75);
  });

  it("builds one digest per completed week, newest first", () => {
    expect(digests.map((d) => d.weekNumber)).toEqual([2, 1]);
  });

  it("ranks teams by how often they were picked, with their record", () => {
    expect(stats.teamRecords[0]).toMatchObject({ team: "KC", picks: 2, wins: 2, losses: 0 });
    expect(stats.teamRecords.map((t) => t.team)).not.toContain("GB"); // week 3 isn't done
  });

  it("standings and streaks run through the last completed week", () => {
    expect(stats.standings.map((r) => [r.displayName, r.points])).toEqual([
      ["Bob", 2],
      ["Alice", 1],
      ["Cara", 0],
    ]);
    expect(stats.streaks[0]).toMatchObject({ displayName: "Bob", current: 2, longest: 2 });
  });

  it("returns empty stats for a season with nothing finished yet", () => {
    const { stats: empty, digests: none } = computeSeasonStats([weeks[2]], PLAYERS, picks);
    expect(empty.completedWeeks).toEqual([]);
    expect(none).toEqual([]);
    expect(empty.totals).toMatchObject({ picks: 0, winPct: 0 });
    expect(empty.standings.every((r) => r.points === 0)).toBe(true);
  });

  it("respects playoff escalation via the points already stored on the pick", () => {
    const playoff = week({ weekNumber: 19, label: "Wild Card", isPlayoff: true, pointValue: 2 });
    const { stats: s, digests: d } = computeSeasonStats(
      [playoff],
      PLAYERS,
      [pick({ userId: "u1", weekNumber: 19, result: "WIN", points: 2 })]
    );
    expect(s.standings[0]).toMatchObject({ displayName: "Alice", points: 2 });
    expect(d[0]).toMatchObject({ label: "Wild Card", isPlayoff: true, pointValue: 2 });
  });
});
