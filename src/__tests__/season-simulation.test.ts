import { describe, it, expect, beforeAll } from "vitest";
import { NFL_TEAMS } from "@/lib/nfl-teams";

// ---------- Types ----------

interface SimGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  homeScore: number;
  awayScore: number;
}

interface SimWeek {
  weekNumber: number;
  isPlayoff: boolean;
  pointValue: number;
  games: SimGame[];
}

interface SimPick {
  playerId: string;
  weekNumber: number;
  team: string;
  result: "WIN" | "LOSS" | "PUSH";
  points: number;
}

// ---------- Logic mirrors (same as routes/pages) ----------

function gradePickResult(
  pickTeam: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number
): "WIN" | "LOSS" | "PUSH" {
  // A level game is a push for both teams — no winner, no loser (#113).
  if (homeScore === awayScore) return "PUSH";
  const winner = homeScore > awayScore ? homeTeam : awayTeam;
  return pickTeam === winner ? "WIN" : "LOSS";
}

function isTeamLocked(team: string, games: SimGame[], now: Date): boolean {
  const game = games.find((g) => g.homeTeam === team || g.awayTeam === team);
  if (!game) return true;
  return now >= game.kickoff;
}

function isPickVisible(
  pickTeam: string,
  games: SimGame[],
  isOwnPick: boolean,
  isAdmin: boolean,
  now: Date
): boolean {
  if (isAdmin || isOwnPick) return true;
  const game = games.find((g) => g.homeTeam === pickTeam || g.awayTeam === pickTeam);
  return game ? now >= game.kickoff : false;
}

// ---------- Schedule generation ----------

const ALL_TEAMS = NFL_TEAMS.map((t) => t.abbr).sort(); // 32 teams, alphabetical

function buildRegularSeasonGames(weekNum: number): SimGame[] {
  // Standard round-robin: fix ALL_TEAMS[0], rotate the remaining 31.
  // Each week uses a different offset, guaranteeing unique pairings.
  const n = ALL_TEAMS.length; // 32
  const fixed = ALL_TEAMS[0]; // ARI
  const pool = ALL_TEAMS.slice(1); // 31 teams
  const offset = (weekNum - 1) % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];

  // Pairing: [fixed, rotated[last]], then [rotated[i], rotated[last-1-i]]
  const pairings: [string, string][] = [[fixed, rotated[rotated.length - 1]]];
  for (let i = 0; i < (n - 2) / 2; i++) {
    pairings.push([rotated[i], rotated[rotated.length - 2 - i]]);
  }

  // Kickoffs staggered: 13:00, 16:00, 19:00 (repeating per game index)
  const weekBase = new Date(2025, 8, 7); // Sept 7, 2025 (week 1 Sunday)
  weekBase.setDate(weekBase.getDate() + (weekNum - 1) * 7);

  return pairings.map(([home, away], i) => {
    const kickoff = new Date(weekBase);
    kickoff.setHours(13 + (i % 3) * 3, 0, 0, 0);
    const homeWins = (weekNum + i) % 3 !== 0;
    return {
      id: `w${weekNum}g${i}`,
      homeTeam: home,
      awayTeam: away,
      kickoff,
      homeScore: homeWins ? 27 : 20,
      awayScore: homeWins ? 20 : 27,
    };
  });
}

// Playoff teams chosen from the "back half" of the alphabet so regular-season
// picks (which tend to start alphabetically) don't exhaust them early.
const PLAYOFF_BRACKETS = [
  {
    weekNumber: 19,
    pointValue: 2,
    teams: ["LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS"],
  },
  { weekNumber: 20, pointValue: 3, teams: ["MIA", "MIN", "NO", "PHI", "PIT", "SEA", "SF", "TB"] },
  { weekNumber: 21, pointValue: 4, teams: ["MIN", "NO", "PHI", "SF"] },
  { weekNumber: 22, pointValue: 5, teams: ["NO", "SF"] },
];

function buildPlayoffGames(weekNum: number, teams: string[]): SimGame[] {
  const n = teams.length;
  const playoffStart = new Date(2026, 0, 11); // Jan 11, 2026
  const weekBase = new Date(playoffStart);
  weekBase.setDate(weekBase.getDate() + (weekNum - 19) * 7);

  return Array.from({ length: n / 2 }, (_, i) => {
    const home = teams[i];
    const away = teams[n - 1 - i];
    const kickoff = new Date(weekBase);
    kickoff.setHours(13 + (i % 3) * 3, 0, 0, 0);
    const homeWins = (weekNum + i) % 3 !== 0;
    return {
      id: `w${weekNum}g${i}`,
      homeTeam: home,
      awayTeam: away,
      kickoff,
      homeScore: homeWins ? 27 : 20,
      awayScore: homeWins ? 20 : 27,
    };
  });
}

function buildSeason(): SimWeek[] {
  const weeks: SimWeek[] = [];
  for (let w = 1; w <= 18; w++) {
    weeks.push({ weekNumber: w, isPlayoff: false, pointValue: 1, games: buildRegularSeasonGames(w) });
  }
  for (const pb of PLAYOFF_BRACKETS) {
    weeks.push({
      weekNumber: pb.weekNumber,
      isPlayoff: true,
      pointValue: pb.pointValue,
      games: buildPlayoffGames(pb.weekNumber, pb.teams),
    });
  }
  return weeks;
}

// ---------- Player simulation ----------

const PLAYERS = ["alice", "bob", "charlie", "diana", "evan", "fiona", "george", "hana", "ivan", "julia"];

// Three teams for trophy calculation; ivan/julia are teamless
const PLAYER_TEAM_MAP = new Map<string, string>([
  ["alice", "Alpha"],
  ["bob", "Alpha"],
  ["charlie", "Alpha"],
  ["diana", "Beta"],
  ["evan", "Beta"],
  ["fiona", "Beta"],
  ["george", "Gamma"],
  ["hana", "Gamma"],
]);

function simulateSeason(weeks: SimWeek[]): {
  picks: SimPick[];
  usedTeams: Map<string, Set<string>>;
} {
  const usedTeams = new Map<string, Set<string>>(PLAYERS.map((p) => [p, new Set()]));
  const picks: SimPick[] = [];

  for (const week of weeks) {
    const playingThisWeek = week.games.flatMap((g) => [g.homeTeam, g.awayTeam]).sort();

    for (let pi = 0; pi < PLAYERS.length; pi++) {
      const player = PLAYERS[pi];
      const used = usedTeams.get(player)!;
      const available = playingThisWeek.filter((t) => !used.has(t));
      if (available.length === 0) continue;

      // Each player picks a different offset into the available list
      const team = available[(pi * 3) % available.length];
      used.add(team);

      const game = week.games.find((g) => g.homeTeam === team || g.awayTeam === team)!;
      const result = gradePickResult(team, game.homeTeam, game.awayTeam, game.homeScore, game.awayScore);

      picks.push({ playerId: player, weekNumber: week.weekNumber, team, result, points: result === "WIN" ? week.pointValue : 0 });
    }
  }

  return { picks, usedTeams };
}

function computeTeamTrophy(picks: SimPick[]): Map<string, number> {
  const playerWinPct = new Map<string, number>();
  for (const player of PLAYERS) {
    const pp = picks.filter((p) => p.playerId === player);
    if (pp.length > 0) {
      playerWinPct.set(player, pp.filter((p) => p.result === "WIN").length / pp.length);
    }
  }

  const teamScores = new Map<string, number>();
  const teamMembers = new Map<string, string[]>();
  for (const [player, teamName] of PLAYER_TEAM_MAP) {
    if (!teamMembers.has(teamName)) teamMembers.set(teamName, []);
    teamMembers.get(teamName)!.push(player);
  }
  for (const [teamName, members] of teamMembers) {
    const active = members.filter((m) => playerWinPct.has(m));
    if (active.length === 0) continue;
    teamScores.set(
      teamName,
      active.reduce((sum, m) => sum + playerWinPct.get(m)!, 0) / active.length
    );
  }

  return teamScores;
}

// ---------- Tests ----------

describe("Full Season Simulation", () => {
  let allWeeks: SimWeek[];
  let allPicks: SimPick[];
  let usedTeams: Map<string, Set<string>>;
  let teamTrophy: Map<string, number>;

  beforeAll(() => {
    allWeeks = buildSeason();
    ({ picks: allPicks, usedTeams } = simulateSeason(allWeeks));
    teamTrophy = computeTeamTrophy(allPicks);
  });

  // --- Season structure ---

  describe("season structure", () => {
    it("has 22 weeks total (18 regular + 4 playoff)", () => {
      expect(allWeeks).toHaveLength(22);
      expect(allWeeks.filter((w) => !w.isPlayoff)).toHaveLength(18);
      expect(allWeeks.filter((w) => w.isPlayoff)).toHaveLength(4);
    });

    it("each regular-season week has 16 games covering all 32 teams exactly once", () => {
      for (const week of allWeeks.filter((w) => !w.isPlayoff)) {
        expect(week.games).toHaveLength(16);
        const teams = week.games.flatMap((g) => [g.homeTeam, g.awayTeam]);
        const seen = new Set<string>();
        for (const t of teams) {
          expect(seen.has(t), `${t} appears twice in week ${week.weekNumber}`).toBe(false);
          seen.add(t);
        }
        expect(seen.size).toBe(32);
      }
    });

    it("playoff weeks have the correct number of games", () => {
      const expected: Record<number, number> = { 19: 7, 20: 4, 21: 2, 22: 1 };
      for (const [weekNum, gameCount] of Object.entries(expected)) {
        const week = allWeeks.find((w) => w.weekNumber === Number(weekNum))!;
        expect(week.games, `week ${weekNum}`).toHaveLength(gameCount);
      }
    });

    it("regular-season weeks are worth 1 point each", () => {
      for (const week of allWeeks.filter((w) => !w.isPlayoff)) {
        expect(week.pointValue).toBe(1);
      }
    });

    it("playoff point values escalate correctly (2 / 3 / 4 / 5)", () => {
      const expected: Record<number, number> = { 19: 2, 20: 3, 21: 4, 22: 5 };
      for (const [weekNum, pts] of Object.entries(expected)) {
        const week = allWeeks.find((w) => w.weekNumber === Number(weekNum))!;
        expect(week.pointValue, `week ${weekNum}`).toBe(pts);
      }
    });
  });

  // --- No-reuse rule ---

  describe("no-reuse rule", () => {
    it("no player picks the same team twice across the full season", () => {
      for (const player of PLAYERS) {
        const teams = allPicks.filter((p) => p.playerId === player).map((p) => p.team);
        expect(new Set(teams).size, `${player} has duplicate picks`).toBe(teams.length);
      }
    });

    it("each player's picks match their usedTeams set exactly", () => {
      for (const player of PLAYERS) {
        const picked = new Set(allPicks.filter((p) => p.playerId === player).map((p) => p.team));
        expect(picked).toEqual(usedTeams.get(player));
      }
    });

    it("each player makes at most one pick per week", () => {
      for (const player of PLAYERS) {
        const byWeek = new Map<number, number>();
        for (const pick of allPicks.filter((p) => p.playerId === player)) {
          byWeek.set(pick.weekNumber, (byWeek.get(pick.weekNumber) ?? 0) + 1);
        }
        for (const [weekNum, count] of byWeek) {
          expect(count, `${player} has ${count} picks in week ${weekNum}`).toBe(1);
        }
      }
    });

    it("all players cover all 18 regular-season weeks", () => {
      for (const player of PLAYERS) {
        const regWeeks = new Set(
          allPicks.filter((p) => p.playerId === player && p.weekNumber <= 18).map((p) => p.weekNumber)
        );
        expect(regWeeks.size, `${player} missing regular-season weeks`).toBe(18);
      }
    });
  });

  // --- Grading ---

  describe("grading", () => {
    it("every pick is either WIN or LOSS — no PENDING after season ends", () => {
      for (const pick of allPicks) {
        expect(["WIN", "LOSS"]).toContain(pick.result);
      }
    });

    it("WIN picks earn exactly the week's pointValue", () => {
      for (const pick of allPicks.filter((p) => p.result === "WIN")) {
        const week = allWeeks.find((w) => w.weekNumber === pick.weekNumber)!;
        expect(pick.points, `WIN in week ${pick.weekNumber}`).toBe(week.pointValue);
      }
    });

    it("LOSS picks earn 0 points", () => {
      for (const pick of allPicks.filter((p) => p.result === "LOSS")) {
        expect(pick.points).toBe(0);
      }
    });

    it("a level game grades both teams' pickers as a PUSH — 0 points, not a win (#113)", () => {
      const home = gradePickResult("KC", "KC", "BUF", 20, 20);
      const away = gradePickResult("BUF", "KC", "BUF", 20, 20);
      expect(home).toBe("PUSH");
      expect(away).toBe("PUSH");
      // Points follow the same rule the sim/route use: only a WIN earns points.
      const points = (r: "WIN" | "LOSS" | "PUSH") => (r === "WIN" ? 1 : 0);
      expect(points(home)).toBe(0);
      expect(points(away)).toBe(0);
    });

    it("win% treats a tie as a push — excluded from the denominator (#113)", () => {
      // wins / (wins + losses) — a PUSH is in neither, so it neither helps nor
      // hurts, matching the leaderboard route's winPct.
      const picks: SimPick[] = [
        { playerId: "p", weekNumber: 1, team: "KC", result: "WIN", points: 1 },
        { playerId: "p", weekNumber: 2, team: "BUF", result: "PUSH", points: 0 },
        { playerId: "p", weekNumber: 3, team: "SF", result: "LOSS", points: 0 },
      ];
      const wins = picks.filter((p) => p.result === "WIN").length;
      const losses = picks.filter((p) => p.result === "LOSS").length;
      const winPct = wins / (wins + losses || 1);
      expect(winPct).toBe(0.5); // 1 win, 1 loss, tie ignored — not 1/3
    });

    it("each player's total equals the sum of their weekly points", () => {
      for (const player of PLAYERS) {
        const pp = allPicks.filter((p) => p.playerId === player);
        const summedTotal = pp.reduce((s, p) => s + p.points, 0);
        const expectedTotal = pp
          .filter((p) => p.result === "WIN")
          .reduce((s, p) => s + allWeeks.find((w) => w.weekNumber === p.weekNumber)!.pointValue, 0);
        expect(summedTotal).toBe(expectedTotal);
      }
    });
  });

  // --- Playoff point escalation ---

  describe("playoff point escalation", () => {
    it.each([
      [19, "Wild Card", 2],
      [20, "Divisional", 3],
      [21, "Conference Championship", 4],
      [22, "Super Bowl", 5],
    ])("week %i (%s) wins are worth %i points", (weekNum, _label, pts) => {
      const wins = allPicks.filter((p) => p.weekNumber === weekNum && p.result === "WIN");
      expect(wins.length, `no wins found in week ${weekNum}`).toBeGreaterThan(0);
      for (const pick of wins) {
        expect(pick.points, `week ${weekNum} win`).toBe(pts);
      }
    });

    it("playoff losses are still worth 0 points", () => {
      const playoffLosses = allPicks.filter((p) => p.weekNumber >= 19 && p.result === "LOSS");
      expect(playoffLosses.length).toBeGreaterThan(0);
      for (const pick of playoffLosses) expect(pick.points).toBe(0);
    });

    it("no player uses a regular-season team again in the playoffs", () => {
      for (const player of PLAYERS) {
        const regTeams = new Set(
          allPicks.filter((p) => p.playerId === player && p.weekNumber <= 18).map((p) => p.team)
        );
        for (const pick of allPicks.filter((p) => p.playerId === player && p.weekNumber >= 19)) {
          expect(regTeams.has(pick.team), `${player} reused ${pick.team} in playoff week ${pick.weekNumber}`).toBe(false);
        }
      }
    });
  });

  // --- Season totals ---

  describe("season totals", () => {
    it("theoretical max score is 32 (all wins across 22 weeks)", () => {
      // 18 × 1 + 2 + 3 + 4 + 5 = 32
      const maxPossible = allWeeks.reduce((s, w) => s + w.pointValue, 0);
      expect(maxPossible).toBe(32);
    });

    it("no player exceeds the theoretical max score", () => {
      for (const player of PLAYERS) {
        const total = allPicks.filter((p) => p.playerId === player).reduce((s, p) => s + p.points, 0);
        expect(total).toBeLessThanOrEqual(32);
      }
    });

    it("all players have at least one win across the season", () => {
      for (const player of PLAYERS) {
        const wins = allPicks.filter((p) => p.playerId === player && p.result === "WIN");
        expect(wins.length, `${player} has no wins`).toBeGreaterThan(0);
      }
    });

    it("each player picks between 18 and 22 teams total", () => {
      for (const player of PLAYERS) {
        const total = allPicks.filter((p) => p.playerId === player).length;
        expect(total).toBeGreaterThanOrEqual(18);
        expect(total).toBeLessThanOrEqual(22);
      }
    });
  });

  // --- Team trophy ---

  describe("team trophy", () => {
    it("computes a trophy score for all three teams", () => {
      expect(teamTrophy.has("Alpha")).toBe(true);
      expect(teamTrophy.has("Beta")).toBe(true);
      expect(teamTrophy.has("Gamma")).toBe(true);
    });

    it("trophy scores are win percentages (0 to 1)", () => {
      for (const [name, score] of teamTrophy) {
        expect(score, `${name} trophy`).toBeGreaterThanOrEqual(0);
        expect(score, `${name} trophy`).toBeLessThanOrEqual(1);
      }
    });

    it("team trophy equals the average win% of its members", () => {
      for (const [teamName, members] of [
        ["Alpha", ["alice", "bob", "charlie"]],
        ["Beta", ["diana", "evan", "fiona"]],
        ["Gamma", ["george", "hana"]],
      ] as [string, string[]][]) {
        const memberWinPcts = members.map((m) => {
          const pp = allPicks.filter((p) => p.playerId === m);
          return pp.filter((p) => p.result === "WIN").length / pp.length;
        });
        const expected = memberWinPcts.reduce((s, v) => s + v, 0) / memberWinPcts.length;
        expect(teamTrophy.get(teamName)).toBeCloseTo(expected, 10);
      }
    });

    it("a team whose members all go perfect scores 1.0", () => {
      const fakePicks: SimPick[] = [
        { playerId: "p1", weekNumber: 1, team: "KC", result: "WIN", points: 1 },
        { playerId: "p2", weekNumber: 1, team: "BUF", result: "WIN", points: 1 },
      ];
      const fakeTeamMap = new Map([["p1", "Perfect"], ["p2", "Perfect"]]);
      const fakePlayers = ["p1", "p2"];

      const pct = new Map<string, number>();
      for (const p of fakePlayers) {
        const pp = fakePicks.filter((pk) => pk.playerId === p);
        pct.set(p, pp.filter((pk) => pk.result === "WIN").length / pp.length);
      }
      const avgPct = [...pct.values()].reduce((s, v) => s + v, 0) / pct.size;
      expect(avgPct).toBe(1.0);
    });
  });

  // --- Pick visibility ---

  describe("pick visibility", () => {
    it("own picks are always visible regardless of kickoff", () => {
      const week1 = allWeeks[0];
      const beforeAny = new Date(week1.games[0].kickoff.getTime() - 3_600_000);
      for (const game of week1.games) {
        expect(isPickVisible(game.homeTeam, week1.games, true, false, beforeAny)).toBe(true);
        expect(isPickVisible(game.awayTeam, week1.games, true, false, beforeAny)).toBe(true);
      }
    });

    it("admin sees all picks before any game starts", () => {
      const week1 = allWeeks[0];
      const beforeAny = new Date(week1.games[0].kickoff.getTime() - 3_600_000);
      for (const game of week1.games) {
        expect(isPickVisible(game.homeTeam, week1.games, false, true, beforeAny)).toBe(true);
      }
    });

    it("other players' picks are hidden before kickoff", () => {
      const week1 = allWeeks[0];
      const beforeAny = new Date(week1.games[0].kickoff.getTime() - 3_600_000);
      for (const game of week1.games) {
        expect(isPickVisible(game.homeTeam, week1.games, false, false, beforeAny)).toBe(false);
        expect(isPickVisible(game.awayTeam, week1.games, false, false, beforeAny)).toBe(false);
      }
    });

    it("picks become visible after their specific game kicks off (per-game, not global)", () => {
      const week1 = allWeeks[0];
      // games[0] kicks at 13:00, games[2] kicks at 19:00 (see stagger: 13 + (i%3)*3)
      const earlyGame = week1.games[0]; // 13:00
      const lateGame = week1.games[2];  // 19:00
      const afterEarlyKickoff = new Date(earlyGame.kickoff.getTime() + 60_000);

      expect(lateGame.kickoff.getTime()).toBeGreaterThan(afterEarlyKickoff.getTime());

      // Early game teams are now visible
      expect(isPickVisible(earlyGame.homeTeam, week1.games, false, false, afterEarlyKickoff)).toBe(true);
      expect(isPickVisible(earlyGame.awayTeam, week1.games, false, false, afterEarlyKickoff)).toBe(true);

      // Late game teams are still hidden
      expect(isPickVisible(lateGame.homeTeam, week1.games, false, false, afterEarlyKickoff)).toBe(false);
      expect(isPickVisible(lateGame.awayTeam, week1.games, false, false, afterEarlyKickoff)).toBe(false);
    });

    it("all picks visible once all games have kicked off", () => {
      const week1 = allWeeks[0];
      const lastKickoff = week1.games.reduce(
        (latest, g) => (g.kickoff > latest ? g.kickoff : latest),
        new Date(0)
      );
      const afterAll = new Date(lastKickoff.getTime() + 60_000);
      for (const game of week1.games) {
        expect(isPickVisible(game.homeTeam, week1.games, false, false, afterAll)).toBe(true);
        expect(isPickVisible(game.awayTeam, week1.games, false, false, afterAll)).toBe(true);
      }
    });
  });

  // --- Per-game team locking ---

  describe("per-game team locking", () => {
    it("teams lock at their own kickoff, not all at once", () => {
      const week1 = allWeeks[0];
      const earlyGame = week1.games[0]; // 13:00
      const lateGame = week1.games[2];  // 19:00
      const afterEarlyKickoff = new Date(earlyGame.kickoff.getTime() + 60_000);

      expect(isTeamLocked(earlyGame.homeTeam, week1.games, afterEarlyKickoff)).toBe(true);
      expect(isTeamLocked(earlyGame.awayTeam, week1.games, afterEarlyKickoff)).toBe(true);
      expect(isTeamLocked(lateGame.homeTeam, week1.games, afterEarlyKickoff)).toBe(false);
      expect(isTeamLocked(lateGame.awayTeam, week1.games, afterEarlyKickoff)).toBe(false);
    });

    it("all teams locked after the last kickoff", () => {
      const week1 = allWeeks[0];
      const lastKickoff = week1.games.reduce(
        (latest, g) => (g.kickoff > latest ? g.kickoff : latest),
        new Date(0)
      );
      const afterAll = new Date(lastKickoff.getTime() + 60_000);
      for (const game of week1.games) {
        expect(isTeamLocked(game.homeTeam, week1.games, afterAll)).toBe(true);
        expect(isTeamLocked(game.awayTeam, week1.games, afterAll)).toBe(true);
      }
    });

    it("no team is locked before the first kickoff", () => {
      const week1 = allWeeks[0];
      const firstKickoff = week1.games.reduce(
        (earliest, g) => (g.kickoff < earliest ? g.kickoff : earliest),
        new Date(8_640_000_000_000_000)
      );
      const beforeAny = new Date(firstKickoff.getTime() - 60_000);
      for (const game of week1.games) {
        expect(isTeamLocked(game.homeTeam, week1.games, beforeAny)).toBe(false);
        expect(isTeamLocked(game.awayTeam, week1.games, beforeAny)).toBe(false);
      }
    });

    it("a team not playing this week is always locked", () => {
      // Super Bowl has only 2 teams — any other team is locked
      const sbWeek = allWeeks[allWeeks.length - 1];
      const sbTeams = new Set(sbWeek.games.flatMap((g) => [g.homeTeam, g.awayTeam]));
      const sidelined = ALL_TEAMS.find((t) => !sbTeams.has(t))!;
      expect(isTeamLocked(sidelined, sbWeek.games, new Date(2025, 0, 1))).toBe(true);
    });
  });
});
