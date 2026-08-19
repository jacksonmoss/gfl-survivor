// Demo mode (#161): pure logic behind the one-click week simulation used when
// showing the app to a customer. A beta session lasts an hour and a season
// lasts five months, so there is no way to demonstrate the pick → lock → grade
// → leaderboard loop with real games. This plays one week out on demand.
//
// Everything here is pure and RNG-injected so it can be unit-tested without a
// database; the routes under src/app/api/demo/ do the Prisma work.
//
// NOT a season simulator — that's prisma/sim-season.ts (#108), which runs a
// full 22 weeks through the real schema for regression testing. This is a
// presentation tool, deliberately scoped to a single week.

export type DemoResult = "WIN" | "LOSS" | "PUSH";

/**
 * Is demo mode on for this process?
 *
 * Deliberately read from a server-side env var rather than `NEXT_PUBLIC_*`:
 * the beta stack runs a prebuilt production image, and NEXT_PUBLIC_ values are
 * inlined at build time, so a build-time flag could never be flipped per
 * install. The client asks the server instead (GET /api/demo).
 *
 * Off unless explicitly enabled — an unset or unrecognised value is off, so a
 * production deploy that never mentions DEMO_MODE can't accidentally ship a
 * button that rewrites everyone's picks.
 */
export function isDemoMode(env: { DEMO_MODE?: string } = process.env as { DEMO_MODE?: string }): boolean {
  const raw = env.DEMO_MODE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export interface DemoGame {
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

/** Every team with a game this week — the legal pick pool. */
export function teamsPlaying(games: Pick<DemoGame, "homeTeam" | "awayTeam">[]): string[] {
  return [...new Set(games.flatMap((g) => [g.awayTeam, g.homeTeam]))];
}

export interface DemoPickee {
  userId: string;
  /** Teams this user has already spent this season (any week). */
  usedTeams: string[];
}

export interface DemoAssignment {
  userId: string;
  team: string;
}

/**
 * Assign a random team to each user, honouring the no-reuse rule: a team the
 * user has already picked this season is not a legal choice, so the simulated
 * league stays in a state the app itself would have allowed. Two users may
 * land on the same team — that's legal and makes the leaderboard interesting.
 *
 * A user with no legal team left (late-season, everything spent) is skipped
 * rather than forced into an illegal pick.
 */
export function assignRandomPicks(
  users: DemoPickee[],
  playing: string[],
  rng: () => number,
): DemoAssignment[] {
  const assignments: DemoAssignment[] = [];
  for (const user of users) {
    const used = new Set(user.usedTeams);
    const available = playing.filter((t) => !used.has(t));
    if (available.length === 0) continue;
    assignments.push({ userId: user.userId, team: available[Math.floor(rng() * available.length)] });
  }
  return assignments;
}

// Plausible NFL final scores. The winner is drawn from the upper half and the
// loser from the lower, which keeps margins believable (a 38–34 shootout and a
// 20–17 grind both show up) without ever producing a tie.
const LOSING_SCORES = [3, 6, 7, 10, 13, 14, 16, 17, 20];
const WINNING_SCORES = [17, 20, 21, 23, 24, 27, 28, 31, 34, 38];

/**
 * A fabricated final score. Never a tie: a real tie grades as a PUSH, which is
 * correct behaviour but a confusing thing to hit at random in front of a
 * customer who is trying to understand win/loss. Home wins slightly more often
 * than not, mirroring real home-field advantage.
 */
export function simulateScore(rng: () => number): { homeScore: number; awayScore: number } {
  const winning = WINNING_SCORES[Math.floor(rng() * WINNING_SCORES.length)];
  const candidates = LOSING_SCORES.filter((s) => s < winning);
  const losing = candidates[Math.floor(rng() * candidates.length)];
  const homeWins = rng() < 0.55;
  return {
    homeScore: homeWins ? winning : losing,
    awayScore: homeWins ? losing : winning,
  };
}

/**
 * Grade one pick against a finished game — same rules as the live grader in
 * src/app/api/scores/sync/route.ts: a win scores the week's point value (so
 * playoff escalation comes along for free), a loss scores nothing, and a level
 * game is a PUSH for both sides.
 *
 * Returns null when the picked team isn't in this game, which leaves the pick
 * alone rather than inventing a result for it.
 */
export function gradeDemoPick(
  team: string,
  game: DemoGame,
  pointValue: number,
): { result: DemoResult; points: number } | null {
  if (team !== game.homeTeam && team !== game.awayTeam) return null;
  if (game.homeScore === null || game.awayScore === null) return null;

  if (game.homeScore === game.awayScore) return { result: "PUSH", points: 0 };

  const homeWon = game.homeScore > game.awayScore;
  const pickedHome = team === game.homeTeam;
  return pickedHome === homeWon
    ? { result: "WIN", points: pointValue }
    : { result: "LOSS", points: 0 };
}

/**
 * Slide a whole slate of kickoffs by one constant offset so that its first (or
 * last) game lands on `to`.
 *
 * Constant offset, not per-game rewriting, because the shape of the slate is
 * what makes the demo legible: Thursday night, the Sunday windows, Monday
 * night. Simulating pulls the slate into the past — otherwise the leaderboard
 * would keep hiding the picks it just graded, since visibility is gated on
 * kickoff — and resetting pushes the same slate back into the future so the
 * customer can play the week again.
 */
export function shiftKickoffs(
  kickoffs: Date[],
  anchor: "first" | "last",
  to: Date,
): Date[] {
  if (kickoffs.length === 0) return [];
  const times = kickoffs.map((k) => k.getTime());
  const pivot = anchor === "first" ? Math.min(...times) : Math.max(...times);
  const delta = to.getTime() - pivot;
  return times.map((t) => new Date(t + delta));
}
