// Pure stats engine (#121). Takes a season's plain picks/games/weeks and returns
// typed season-to-date + per-week stats. No Prisma import — the route loads the
// data and calls in here, so every rule below is unit-testable with fixtures
// (same pattern as reminders.ts / odds.ts / rosters.ts).
//
// Two rules run through all of it:
//  - **Pushes are not losses.** A PUSH neither counts toward win% nor breaks a
//    correct-pick streak; it just doesn't extend one.
//  - **Points come from the pick**, which already carries the week's escalated
//    `Week.pointValue` (playoffs are worth 2–5), so nothing here re-multiplies.
//
// Pick visibility is *not* handled here: the route filters picks down to the
// ones whose game has kicked off before calling in. See src/app/api/stats/route.ts.

export type StatsGameStatus = "SCHEDULED" | "LIVE" | "FINAL";
export type StatsPickResult = "PENDING" | "WIN" | "LOSS" | "PUSH";

export interface StatsGame {
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: StatsGameStatus;
  /** Consensus home spread; negative = home favored. Null when odds are unavailable. */
  spreadHome: number | null;
}

export interface StatsWeek {
  weekNumber: number;
  label: string;
  isPlayoff: boolean;
  pointValue: number;
  games: StatsGame[];
}

export interface StatsPlayer {
  id: string;
  displayName: string;
}

export interface StatsPick {
  userId: string;
  weekNumber: number;
  team: string;
  result: StatsPickResult;
  points: number;
}

/** How many entries the "top N" style lists return. */
const TOP_N = 5;
/** A game needs at least this many picks before a sweep is worth calling out. */
const MIN_PICKS_FOR_SWEEP = 2;

/**
 * A week counts as complete once it has games and every one of them is FINAL.
 * The stats page only publishes per-week stats for complete weeks: every game
 * being final implies every game kicked off, so no pick can leak early.
 */
export function isWeekComplete(week: StatsWeek): boolean {
  return week.games.length > 0 && week.games.every((g) => g.status === "FINAL");
}

/** The game a team played that week, or undefined if it was on bye / not scheduled. */
export function findGameForTeam(week: StatsWeek, team: string): StatsGame | undefined {
  return week.games.find((g) => g.homeTeam === team || g.awayTeam === team);
}

/**
 * Winning team of a FINAL game, or null for a tie / an ungraded game. Kept
 * separate from pick results so game-derived stats (upsets, sweeps) don't depend
 * on the grader having run.
 */
export function gameWinner(game: StatsGame): string | null {
  if (game.status !== "FINAL" || game.homeScore === null || game.awayScore === null) return null;
  if (game.homeScore === game.awayScore) return null;
  return game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface StandingRow {
  userId: string;
  displayName: string;
  /** Competition rank (ties share a rank, and the next rank skips: 1, 1, 3). */
  rank: number;
  points: number;
  wins: number;
  losses: number;
  pushes: number;
  /** wins / (wins + losses) — pushes excluded, matching the leaderboard. */
  winPct: number;
}

/**
 * Cumulative standings through `throughWeek` (inclusive), built by summing each
 * player's picks over weeks 1..N. That's why lead changes need no snapshot
 * table — "standings as of week N−1" is just this function with a smaller N.
 *
 * Players with no picks are still included (0 points, 0%), so the pool roster is
 * stable week to week and a rank delta always has both endpoints.
 */
export function standingsThrough(
  players: StatsPlayer[],
  picks: StatsPick[],
  throughWeek: number
): StandingRow[] {
  const rows = players.map((p) => {
    const mine = picks.filter((k) => k.userId === p.id && k.weekNumber <= throughWeek);
    const wins = mine.filter((k) => k.result === "WIN").length;
    const losses = mine.filter((k) => k.result === "LOSS").length;
    const pushes = mine.filter((k) => k.result === "PUSH").length;
    return {
      userId: p.id,
      displayName: p.displayName,
      rank: 0,
      points: mine.reduce((sum, k) => sum + k.points, 0),
      wins,
      losses,
      pushes,
      winPct: wins + losses > 0 ? wins / (wins + losses) : 0,
    };
  });

  // Points first, then wins as the tiebreak, then name so the order is stable
  // across calls (an unstable order would invent phantom rank deltas).
  rows.sort(
    (a, b) =>
      b.points - a.points || b.wins - a.wins || a.displayName.localeCompare(b.displayName)
  );

  let rank = 0;
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    // Only points decide the rank — two players tied on points share a rank even
    // if the sort put one above the other on the wins tiebreak.
    if (i === 0 || row.points !== prev.points) rank = i + 1;
    row.rank = rank;
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Lead changes
// ---------------------------------------------------------------------------

export interface RankMove {
  displayName: string;
  /** Rank before the week, and after it. A *smaller* number is better. */
  from: number;
  to: number;
  /** Positive = moved up the board. */
  delta: number;
}

export interface LeadChange {
  /** Everyone at rank 1 after the week (plural when co-leaders). */
  leaders: string[];
  /** Everyone who was at rank 1 before it. */
  previousLeaders: string[];
  /** True when the set of rank-1 players changed at all. */
  leadChanged: boolean;
  biggestRiser: RankMove | null;
  biggestFaller: RankMove | null;
}

/**
 * Compare two cumulative standings (through week N−1 and through week N) and
 * report who took the lead and who moved most. Returns null when there is no
 * prior week to compare against — the first completed week has no lead change,
 * and the caller renders nothing rather than "everyone rose to their rank".
 */
export function computeLeadChange(
  previous: StandingRow[] | null,
  current: StandingRow[]
): LeadChange | null {
  if (!previous) return null;

  const prevRank = new Map(previous.map((r) => [r.userId, r.rank]));
  const leaders = current.filter((r) => r.rank === 1).map((r) => r.displayName);
  const previousLeaders = previous.filter((r) => r.rank === 1).map((r) => r.displayName);

  const moves: RankMove[] = current
    .filter((r) => prevRank.has(r.userId))
    .map((r) => ({
      displayName: r.displayName,
      from: prevRank.get(r.userId)!,
      to: r.rank,
      delta: prevRank.get(r.userId)! - r.rank,
    }))
    .filter((m) => m.delta !== 0);

  const risers = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta);
  const fallers = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta);

  const sameLeaders =
    leaders.length === previousLeaders.length &&
    leaders.every((n) => previousLeaders.includes(n));

  return {
    leaders,
    previousLeaders,
    leadChanged: !sameLeaders,
    biggestRiser: risers[0] ?? null,
    biggestFaller: fallers[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pick distribution
// ---------------------------------------------------------------------------

export interface TeamPickCount {
  team: string;
  count: number;
  /** Share of that week's picks, 0–1. */
  pct: number;
  /** Whether the picked team won its game; null when the game wasn't graded. */
  won: boolean | null;
}

export interface GamePickCount {
  homeTeam: string;
  awayTeam: string;
  count: number;
  pct: number;
}

/** Every team picked that week, most-picked first (ties broken alphabetically). */
export function teamPickCounts(week: StatsWeek, weekPicks: StatsPick[]): TeamPickCount[] {
  const total = weekPicks.length;
  const counts = new Map<string, number>();
  for (const p of weekPicks) counts.set(p.team, (counts.get(p.team) ?? 0) + 1);

  return Array.from(counts.entries())
    .map(([team, count]) => {
      const game = findGameForTeam(week, team);
      const winner = game ? gameWinner(game) : null;
      return {
        team,
        count,
        pct: total > 0 ? count / total : 0,
        // A tie (winner null on a FINAL game) is neither won nor lost — leave it
        // null so a push never shows up as a bust.
        won: game && game.status === "FINAL" ? (winner === null ? null : winner === team) : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
}

/** Every game that drew a pick, most-picked first. Counts both sides of a game. */
export function gamePickCounts(week: StatsWeek, weekPicks: StatsPick[]): GamePickCount[] {
  const total = weekPicks.length;
  return week.games
    .map((g) => {
      const count = weekPicks.filter((p) => p.team === g.homeTeam || p.team === g.awayTeam).length;
      return {
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        count,
        pct: total > 0 ? count / total : 0,
      };
    })
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count || a.homeTeam.localeCompare(b.homeTeam));
}

/**
 * The most-picked team that lost — the week's collective faceplant. Ties in the
 * count resolve alphabetically via `teamPickCounts`. Null when every popular
 * pick held up (or when the losing picks tied).
 */
export function consensusBust(counts: TeamPickCount[]): TeamPickCount | null {
  return counts.find((c) => c.won === false) ?? null;
}

// ---------------------------------------------------------------------------
// Upsets
// ---------------------------------------------------------------------------

export interface Upset {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: string;
  loser: string;
  /** Points the winner was getting — always positive. */
  underdogBy: number;
  /** Players who picked the underdog and cashed in. */
  benefited: string[];
  /** Players who picked the favorite and ate it. */
  burned: string[];
}

/**
 * Games a week's underdog won, biggest upset first. Needs `spreadHome`, so games
 * with no odds (preseason, international, no ODDS_API_KEY) are skipped rather
 * than guessed at, and a pick'em (spread 0) can't be an upset by definition.
 */
export function findUpsets(
  week: StatsWeek,
  weekPicks: StatsPick[],
  nameByUserId: Map<string, string>
): Upset[] {
  const upsets: Upset[] = [];

  for (const game of week.games) {
    if (game.spreadHome === null || game.spreadHome === 0) continue;
    const winner = gameWinner(game);
    if (!winner) continue; // unplayed or tied

    const underdog = game.spreadHome < 0 ? game.awayTeam : game.homeTeam;
    if (winner !== underdog) continue;

    const loser = winner === game.homeTeam ? game.awayTeam : game.homeTeam;
    upsets.push({
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore!,
      awayScore: game.awayScore!,
      winner,
      loser,
      underdogBy: Math.abs(game.spreadHome),
      benefited: pickerNames(weekPicks, winner, nameByUserId),
      burned: pickerNames(weekPicks, loser, nameByUserId),
    });
  }

  return upsets.sort((a, b) => b.underdogBy - a.underdogBy);
}

function pickerNames(
  weekPicks: StatsPick[],
  team: string,
  nameByUserId: Map<string, string>
): string[] {
  return weekPicks
    .filter((p) => p.team === team)
    .map((p) => nameByUserId.get(p.userId) ?? p.userId)
    .sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Sweeps (perfect / whiffed games)
// ---------------------------------------------------------------------------

export interface GameSweep {
  homeTeam: string;
  awayTeam: string;
  team: string;
  count: number;
  players: string[];
}

/**
 * Games where every pick landed on the same side and that side won (`perfect`)
 * or lost (`whiffed`). Requires at least MIN_PICKS_FOR_SWEEP picks — one lonely
 * correct pick isn't a sweep, it's a pick.
 */
export function findSweeps(
  week: StatsWeek,
  weekPicks: StatsPick[],
  nameByUserId: Map<string, string>
): { perfect: GameSweep[]; whiffed: GameSweep[] } {
  const perfect: GameSweep[] = [];
  const whiffed: GameSweep[] = [];

  for (const game of week.games) {
    const winner = gameWinner(game);
    if (!winner) continue;
    const loser = winner === game.homeTeam ? game.awayTeam : game.homeTeam;

    const onWinner = pickerNames(weekPicks, winner, nameByUserId);
    const onLoser = pickerNames(weekPicks, loser, nameByUserId);

    if (onWinner.length >= MIN_PICKS_FOR_SWEEP && onLoser.length === 0) {
      perfect.push({ homeTeam: game.homeTeam, awayTeam: game.awayTeam, team: winner, count: onWinner.length, players: onWinner });
    } else if (onLoser.length >= MIN_PICKS_FOR_SWEEP && onWinner.length === 0) {
      whiffed.push({ homeTeam: game.homeTeam, awayTeam: game.awayTeam, team: loser, count: onLoser.length, players: onLoser });
    }
  }

  const byCount = (a: GameSweep, b: GameSweep) => b.count - a.count;
  return { perfect: perfect.sort(byCount), whiffed: whiffed.sort(byCount) };
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface StreakRow {
  userId: string;
  displayName: string;
  /** Consecutive wins running up to the latest graded week. */
  current: number;
  /** Longest such run at any point in the season. */
  longest: number;
}

/**
 * Correct-pick streaks through `throughWeek`. A LOSS breaks a streak; a PUSH
 * doesn't (it neither extends nor ends it, mirroring how win% ignores pushes);
 * a PENDING pick or a skipped week is simply not counted.
 */
export function computeStreaks(
  players: StatsPlayer[],
  picks: StatsPick[],
  throughWeek: number
): StreakRow[] {
  return players
    .map((p) => {
      const mine = picks
        .filter((k) => k.userId === p.id && k.weekNumber <= throughWeek)
        .sort((a, b) => a.weekNumber - b.weekNumber);

      let current = 0;
      let longest = 0;
      for (const k of mine) {
        if (k.result === "WIN") {
          current++;
          longest = Math.max(longest, current);
        } else if (k.result === "LOSS") {
          current = 0;
        }
      }
      return { userId: p.id, displayName: p.displayName, current, longest };
    })
    .sort((a, b) => b.current - a.current || b.longest - a.longest || a.displayName.localeCompare(b.displayName));
}

// ---------------------------------------------------------------------------
// Weekly digest
// ---------------------------------------------------------------------------

export interface NotableLosses {
  /** How many players lost that week. */
  total: number;
  /** Players who were rank 1 going into the week and lost it. */
  leadersWhoLost: string[];
  /** The longest active streak the week ended, if any. */
  streakBroken: { displayName: string; streak: number } | null;
}

export interface WeeklyDigest {
  weekNumber: number;
  label: string;
  isPlayoff: boolean;
  pointValue: number;
  /** Picks counted this week, and how many were right. */
  pickCount: number;
  correctCount: number;
  /** Cumulative standings through this week, and everyone at rank 1. */
  standings: StandingRow[];
  leaders: StandingRow[];
  leadChange: LeadChange | null;
  mostPickedTeam: TeamPickCount | null;
  mostPickedGame: GamePickCount | null;
  consensusBust: TeamPickCount | null;
  upsets: Upset[];
  perfectGames: GameSweep[];
  whiffedGames: GameSweep[];
  losses: NotableLosses;
}

/**
 * Everything worth saying about one completed week. Returns structured data
 * only — no prose — so the page renders it and #145's executive summary can
 * narrate the same digest without recomputing anything.
 *
 * `previousWeekNumber` is the previous *completed* week (not simply N−1): if a
 * week is skipped or still in progress, the lead change compares against the
 * last week that actually finished. Pass null for the season's first one.
 */
export function computeWeeklyDigest(
  week: StatsWeek,
  players: StatsPlayer[],
  picks: StatsPick[],
  previousWeekNumber: number | null
): WeeklyDigest {
  const nameByUserId = new Map(players.map((p) => [p.id, p.displayName]));
  const weekPicks = picks.filter((p) => p.weekNumber === week.weekNumber);

  const standings = standingsThrough(players, picks, week.weekNumber);
  const previous =
    previousWeekNumber === null ? null : standingsThrough(players, picks, previousWeekNumber);

  const counts = teamPickCounts(week, weekPicks);
  const games = gamePickCounts(week, weekPicks);
  const { perfect, whiffed } = findSweeps(week, weekPicks, nameByUserId);

  const losers = weekPicks.filter((p) => p.result === "LOSS");
  const priorLeaders = new Set(
    (previous ?? []).filter((r) => r.rank === 1).map((r) => r.userId)
  );

  // A streak "broken" this week: someone who lost, ranked by how long their run
  // was going into the week. Streaks *through the prior week* are the run that
  // the loss actually ended.
  const streaksBefore =
    previousWeekNumber === null ? [] : computeStreaks(players, picks, previousWeekNumber);
  const streakBefore = new Map(streaksBefore.map((s) => [s.userId, s.current]));
  const broken = losers
    .map((p) => ({ displayName: nameByUserId.get(p.userId) ?? p.userId, streak: streakBefore.get(p.userId) ?? 0 }))
    .filter((s) => s.streak > 0)
    .sort((a, b) => b.streak - a.streak);

  return {
    weekNumber: week.weekNumber,
    label: week.label,
    isPlayoff: week.isPlayoff,
    pointValue: week.pointValue,
    pickCount: weekPicks.length,
    correctCount: weekPicks.filter((p) => p.result === "WIN").length,
    standings,
    leaders: standings.filter((r) => r.rank === 1),
    leadChange: computeLeadChange(previous, standings),
    mostPickedTeam: counts[0] ?? null,
    mostPickedGame: games[0] ?? null,
    consensusBust: consensusBust(counts),
    upsets: findUpsets(week, weekPicks, nameByUserId),
    perfectGames: perfect,
    whiffedGames: whiffed,
    losses: {
      total: losers.length,
      leadersWhoLost: losers
        .filter((p) => priorLeaders.has(p.userId))
        .map((p) => nameByUserId.get(p.userId) ?? p.userId)
        .sort((a, b) => a.localeCompare(b)),
      streakBroken: broken[0] ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Season stats
// ---------------------------------------------------------------------------

export interface TeamRecord {
  team: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
}

export interface SeasonStats {
  /** Week numbers that are complete, ascending. Per-week stats exist only for these. */
  completedWeeks: number[];
  standings: StandingRow[];
  streaks: StreakRow[];
  /** Most-picked teams across the season, with how they actually did. */
  teamRecords: TeamRecord[];
  totals: {
    picks: number;
    wins: number;
    losses: number;
    pushes: number;
    /** Pool-wide hit rate, pushes excluded. */
    winPct: number;
  };
}

/**
 * Season-to-date rollup over the completed weeks only, plus a digest for each of
 * them (newest first, matching how the page lists them).
 */
export function computeSeasonStats(
  weeks: StatsWeek[],
  players: StatsPlayer[],
  picks: StatsPick[]
): { stats: SeasonStats; digests: WeeklyDigest[] } {
  const completed = weeks.filter(isWeekComplete).sort((a, b) => a.weekNumber - b.weekNumber);
  const completedWeeks = completed.map((w) => w.weekNumber);
  const latest = completedWeeks[completedWeeks.length - 1] ?? 0;

  // Only completed weeks feed the season rollup, so an in-progress week can't
  // half-count toward a team record or a hit rate.
  const scored = picks.filter((p) => completedWeeks.includes(p.weekNumber));

  const teamCounts = new Map<string, TeamRecord>();
  for (const p of scored) {
    const rec = teamCounts.get(p.team) ?? { team: p.team, picks: 0, wins: 0, losses: 0, pushes: 0 };
    rec.picks++;
    if (p.result === "WIN") rec.wins++;
    else if (p.result === "LOSS") rec.losses++;
    else if (p.result === "PUSH") rec.pushes++;
    teamCounts.set(p.team, rec);
  }

  const wins = scored.filter((p) => p.result === "WIN").length;
  const losses = scored.filter((p) => p.result === "LOSS").length;
  const pushes = scored.filter((p) => p.result === "PUSH").length;

  // Every digest is built from `scored` too, so an in-progress week sandwiched
  // between completed ones can't bleed into a later week's cumulative standings.
  const digests = completed.map((week, i) =>
    computeWeeklyDigest(week, players, scored, i === 0 ? null : completedWeeks[i - 1])
  );

  return {
    stats: {
      completedWeeks,
      standings: standingsThrough(players, scored, latest),
      streaks: computeStreaks(players, scored, latest).slice(0, TOP_N),
      teamRecords: Array.from(teamCounts.values())
        .sort((a, b) => b.picks - a.picks || b.wins - a.wins || a.team.localeCompare(b.team))
        .slice(0, TOP_N),
      totals: {
        picks: scored.length,
        wins,
        losses,
        pushes,
        winPct: wins + losses > 0 ? wins / (wins + losses) : 0,
      },
    },
    digests: digests.reverse(),
  };
}
