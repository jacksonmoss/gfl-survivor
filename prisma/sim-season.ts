import "dotenv/config";
import { execSync } from "child_process";
import { pathToFileURL } from "url";
import pg from "pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildSeasonWeeks } from "../src/lib/season";
import { computeAllGameUpdates } from "../src/lib/score-sync";
import type { DbGame } from "../src/lib/score-sync";
import type { ESPNResponse } from "../src/lib/espn";
import { NFL_TEAMS } from "../src/lib/nfl-teams";

// DB-backed full-season simulator (#108). Plays a whole 22-week season through
// the *real* Prisma schema and the real grading lib (computeAllGameUpdates), so
// the workflow — not just the arithmetic — is proven before a live season can
// break it. Runnable as a script (`pnpm sim:season`, logs a season play-by-play)
// and reused by src/__tests__/sim-season.integration.test.ts for CI regressions.
//
// It only ever touches a disposable database (default `gfl_sim`); assertSafeSimUrl
// refuses to run against the dev DB.

// ---------- Seeded RNG (deterministic, reproducible) ----------

/** mulberry32 — small, fast, deterministic PRNG seeded from a 32-bit int. */
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

// ---------- Teams: reserve a playoff pool ----------

const ALL_TEAMS = NFL_TEAMS.map((t) => t.abbr).sort();

// 12 teams reserved for the playoff bracket. Regular-season picks are drawn only
// from the other 20, so every player reaches the playoffs with unused bracket
// teams available — the no-reuse rule stays satisfiable through week 22.
const PLAYOFF_POOL = ["KC", "BUF", "BAL", "CIN", "PHI", "SF", "DAL", "DET", "GB", "MIA", "LAR", "MIN"];
const REGULAR_POOL = ALL_TEAMS.filter((t) => !PLAYOFF_POOL.includes(t));

// Playoff bracket team sets per week (subsets of PLAYOFF_POOL). SB uses teams
// (indices 8,9) that don't appear in the Divisional/Conference sets, so most
// players still have them free at week 22 — keeping the 5-point path exercised.
const PLAYOFF_WEEK_TEAMS: Record<number, string[]> = {
  19: PLAYOFF_POOL, // Wild Card — 12 teams, 6 games
  20: PLAYOFF_POOL.slice(0, 8), // Divisional — 8 teams, 4 games
  21: PLAYOFF_POOL.slice(0, 4), // Conference — 4 teams, 2 games
  22: PLAYOFF_POOL.slice(8, 10), // Super Bowl — teams 8,9
};

// ---------- Players + teams ----------

const PLAYERS = [
  "alice", "bob", "charlie", "diana", "evan",
  "fiona", "george", "hana", "ivan", "julia",
] as const;

// Three trophy teams; ivan/julia stay teamless (mirrors the demo seed).
const PLAYER_TEAM_MAP: Record<string, string> = {
  alice: "Alpha", bob: "Alpha", charlie: "Alpha",
  diana: "Beta", evan: "Beta", fiona: "Beta",
  george: "Gamma", hana: "Gamma",
};
const TEAM_NAMES = ["Alpha", "Beta", "Gamma"];

// ---------- Schedule generation ----------

interface SimGameSpec {
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  homeScore: number;
  awayScore: number;
}

/**
 * Regular-season round-robin: fix ALL_TEAMS[0], rotate the other 31 by a
 * per-week offset. Guarantees 16 games with all 32 teams appearing exactly once.
 * Winners come from the seeded RNG, so ~half of picks lose.
 */
function buildRegularSeasonGames(weekNum: number, rng: () => number): SimGameSpec[] {
  const n = ALL_TEAMS.length;
  const fixed = ALL_TEAMS[0];
  const pool = ALL_TEAMS.slice(1);
  const offset = (weekNum - 1) % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];

  const pairings: [string, string][] = [[fixed, rotated[rotated.length - 1]]];
  for (let i = 0; i < (n - 2) / 2; i++) {
    pairings.push([rotated[i], rotated[rotated.length - 2 - i]]);
  }

  return pairings.map(([home, away], i) => makeGame(`sim-w${weekNum}-g${i}`, home, away, weekNum, i, rng));
}

/** Playoff week: pair the bracket teams sequentially; home always wins. */
function buildPlayoffGames(weekNum: number): SimGameSpec[] {
  const teams = PLAYOFF_WEEK_TEAMS[weekNum];
  const games: SimGameSpec[] = [];
  for (let i = 0; i < teams.length / 2; i++) {
    const home = teams[i * 2];
    const away = teams[i * 2 + 1];
    // Home wins deterministically so each playoff round reliably produces a
    // graded WIN — keeps the point-escalation (2/3/4/5) path covered.
    games.push({
      externalId: `sim-w${weekNum}-g${i}`,
      homeTeam: home,
      awayTeam: away,
      kickoff: kickoffFor(weekNum, i),
      homeScore: 27,
      awayScore: 20,
    });
  }
  return games;
}

function makeGame(
  externalId: string,
  home: string,
  away: string,
  weekNum: number,
  gameIdx: number,
  rng: () => number,
): SimGameSpec {
  const homeWins = rng() < 0.5;
  return {
    externalId,
    homeTeam: home,
    awayTeam: away,
    kickoff: kickoffFor(weekNum, gameIdx),
    homeScore: homeWins ? 27 : 20,
    awayScore: homeWins ? 20 : 27,
  };
}

// Realistic staggered kickoffs, all in a past season so every game is already
// "in the past" at run time (grading is driven by the FINAL ESPN payload, not
// the wall clock, but this keeps the timestamps sensible).
function kickoffFor(weekNum: number, gameIdx: number): Date {
  const base = new Date(Date.UTC(2020, 8, 6, 17, 0, 0)); // Sun Sep 6, 2020, 1pm ET
  base.setUTCDate(base.getUTCDate() + (weekNum - 1) * 7);
  base.setUTCHours(17 + (gameIdx % 3) * 3); // 1pm / 4pm / 7pm ET slots
  return base;
}

interface SimWeekSpec {
  weekNumber: number;
  isPlayoff: boolean;
  pointValue: number;
  games: SimGameSpec[];
}

function buildSchedule(rng: () => number): SimWeekSpec[] {
  const weekDefs = buildSeasonWeeks(2020);
  return weekDefs.map((w) => ({
    weekNumber: w.weekNumber,
    isPlayoff: w.isPlayoff,
    pointValue: w.pointValue,
    games: w.isPlayoff ? buildPlayoffGames(w.weekNumber) : buildRegularSeasonGames(w.weekNumber, rng),
  }));
}

// ---------- ESPN payload ----------

/** Build an ESPN-shaped scoreboard payload (all FINAL) for a week's games, so
 *  the real grader (computeAllGameUpdates) runs the same path it does in prod. */
function buildEspnPayload(games: SimGameSpec[]): ESPNResponse {
  return {
    events: games.map((g) => ({
      id: g.externalId,
      competitions: [
        {
          id: g.externalId,
          date: g.kickoff.toISOString(),
          competitors: [
            { homeAway: "home", team: { abbreviation: g.homeTeam }, score: String(g.homeScore) },
            { homeAway: "away", team: { abbreviation: g.awayTeam }, score: String(g.awayScore) },
          ],
          status: { type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true } },
        },
      ],
    })),
  };
}

// ---------- Pick selection (honors the no-reuse rule) ----------

/** Pick a team the player is allowed to use this week: playing this week and
 *  not already used this season. Returns null if nothing is available. */
function choosePick(
  weekTeamsPlaying: string[],
  preferredPool: string[],
  used: Set<string>,
  rng: () => number,
): string | null {
  // Prefer the intended pool (regular teams in the regular season), then any
  // eligible team — mirrors real behavior where a player may have to dip out.
  const eligiblePreferred = preferredPool.filter((t) => weekTeamsPlaying.includes(t) && !used.has(t));
  const eligibleAny = weekTeamsPlaying.filter((t) => !used.has(t));
  const pool = eligiblePreferred.length > 0 ? eligiblePreferred : eligibleAny;
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}

// ---------- Result types ----------

export interface SimPickRecord {
  userId: string;
  username: string;
  weekNumber: number;
  team: string;
  result: "PENDING" | "WIN" | "LOSS" | "PUSH";
  points: number;
}

export interface SimTeamTrophy {
  name: string;
  members: string[];
  avgWinPct: number;
}

export interface SimResult {
  weeks: { weekNumber: number; isPlayoff: boolean; pointValue: number }[];
  players: { id: string; username: string; teamName: string | null }[];
  picks: SimPickRecord[];
  trophy: SimTeamTrophy[];
}

// ---------- Core simulation ----------

interface SimOptions {
  seed?: number;
  log?: boolean;
}

/**
 * Seed a season + players + teams, then play weeks 1→22 against the DB: each
 * player picks an eligible team, we grade via the real lib, and persist WIN/LOSS
 * + week.pointValue exactly as the score-sync route does. Returns the graded
 * picks + trophy standings for invariant checking.
 */
export async function runSeasonSimulation(prisma: PrismaClient, opts: SimOptions = {}): Promise<SimResult> {
  const rng = mulberry32(opts.seed ?? 20260725);
  const log = opts.log ?? false;
  const schedule = buildSchedule(rng);

  // --- Seed users + trophy teams ---
  const passwordHash = await bcrypt.hash("simpass", 8);
  const admin = await prisma.user.create({
    data: { username: "sim_admin", passwordHash, displayName: "Sim Admin", role: "ADMIN" },
  });

  const teamsByName = new Map<string, string>();
  for (const name of TEAM_NAMES) {
    const t = await prisma.team.create({ data: { name } });
    teamsByName.set(name, t.id);
  }

  const players: { id: string; username: string; teamName: string | null }[] = [];
  const usedTeams = new Map<string, Set<string>>();
  for (const username of PLAYERS) {
    const teamName = PLAYER_TEAM_MAP[username] ?? null;
    const u = await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName: username[0].toUpperCase() + username.slice(1),
      },
    });
    players.push({ id: u.id, username, teamName });
    usedTeams.set(u.id, new Set());
  }
  void admin;

  // --- Season + weeks via the #107 helper ---
  const season = await prisma.season.create({
    data: {
      year: 2020,
      isActive: true,
      weeks: { create: buildSeasonWeeks(2020) },
    },
    include: { weeks: true },
  });
  const weekIdByNumber = new Map(season.weeks.map((w) => [w.weekNumber, w.id]));

  // Season-scoped roster memberships (#120): assign trophy-team players for this season.
  await prisma.teamMembership.createMany({
    data: players
      .filter((p) => p.teamName)
      .map((p) => ({ userId: p.id, seasonId: season.id, teamId: teamsByName.get(p.teamName!)! })),
  });

  // --- Play each week ---
  for (const week of schedule) {
    const weekId = weekIdByNumber.get(week.weekNumber)!;

    // Create this week's games (SCHEDULED, real scores held back until grading).
    await prisma.game.createMany({
      data: week.games.map((g) => ({
        weekId,
        externalId: g.externalId,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        kickoff: g.kickoff,
        status: "SCHEDULED" as const,
      })),
    });

    const teamsPlaying = week.games.flatMap((g) => [g.homeTeam, g.awayTeam]);
    const preferredPool = week.isPlayoff ? PLAYOFF_WEEK_TEAMS[week.weekNumber] : REGULAR_POOL;

    // Each player makes an eligible pick (no team reused across the season).
    for (const player of players) {
      const used = usedTeams.get(player.id)!;
      const team = choosePick(teamsPlaying, preferredPool, used, rng);
      if (!team) continue;
      used.add(team);
      await prisma.pick.create({ data: { userId: player.id, weekId, team } });
    }

    // Grade: feed the real grader a FINAL ESPN payload, persist like the route.
    const dbGames = await prisma.game.findMany({ where: { weekId } });
    const payload = buildEspnPayload(week.games);
    const updates = computeAllGameUpdates(
      payload,
      dbGames.map<DbGame>((g) => ({
        id: g.id,
        externalId: g.externalId!,
        homeScore: g.homeScore ?? 0,
        awayScore: g.awayScore ?? 0,
        status: g.status as DbGame["status"],
      })),
    );

    let graded = 0;
    for (const update of updates) {
      await prisma.game.update({
        where: { id: update.gameId },
        data: { homeScore: update.homeScore, awayScore: update.awayScore, status: update.status },
      });
      if (update.justFinished && update.winnerTeam && update.losingTeam) {
        const toGrade = await prisma.pick.findMany({
          where: { weekId, team: { in: [update.winnerTeam, update.losingTeam] }, result: "PENDING" },
        });
        for (const pick of toGrade) {
          const isWin = pick.team === update.winnerTeam;
          await prisma.pick.update({
            where: { id: pick.id },
            data: { result: isWin ? "WIN" : "LOSS", points: isWin ? week.pointValue : 0 },
          });
          graded++;
        }
      }
    }

    if (log) await logWeek(prisma, season.id, week, weekId, graded);
  }

  // --- Collect graded picks + trophy ---
  const picks = await collectPicks(prisma, season.id);
  const trophy = computeTrophy(players, picks);

  return {
    weeks: schedule.map((w) => ({ weekNumber: w.weekNumber, isPlayoff: w.isPlayoff, pointValue: w.pointValue })),
    players,
    picks,
    trophy,
  };
}

async function collectPicks(prisma: PrismaClient, seasonId: string): Promise<SimPickRecord[]> {
  const rows = await prisma.pick.findMany({
    where: { week: { seasonId } },
    include: { week: true, user: true },
  });
  return rows.map((p) => ({
    userId: p.userId,
    username: p.user.username,
    weekNumber: p.week.weekNumber,
    team: p.team,
    result: p.result,
    points: p.points,
  }));
}

function computeTrophy(
  players: { id: string; username: string; teamName: string | null }[],
  picks: SimPickRecord[],
): SimTeamTrophy[] {
  // Mirror the leaderboard route: per-player winPct = wins/(wins+losses||1),
  // team score = average of member winPcts.
  const winPct = new Map<string, number>();
  for (const p of players) {
    const pp = picks.filter((x) => x.userId === p.id);
    const wins = pp.filter((x) => x.result === "WIN").length;
    const losses = pp.filter((x) => x.result === "LOSS").length;
    winPct.set(p.id, pp.length > 0 ? wins / (wins + losses || 1) : 0);
  }

  const byTeam = new Map<string, string[]>();
  for (const p of players) {
    if (!p.teamName) continue;
    if (!byTeam.has(p.teamName)) byTeam.set(p.teamName, []);
    byTeam.get(p.teamName)!.push(p.id);
  }

  return Array.from(byTeam.entries())
    .map(([name, memberIds]) => ({
      name,
      members: memberIds.map((id) => players.find((p) => p.id === id)!.username),
      avgWinPct: memberIds.reduce((s, id) => s + winPct.get(id)!, 0) / memberIds.length,
    }))
    .sort((a, b) => b.avgWinPct - a.avgWinPct);
}

// ---------- Invariant checks (shared by CLI + Vitest) ----------

/** Return a list of invariant violations; empty array means the season is sound. */
export function checkInvariants(result: SimResult): string[] {
  const errors: string[] = [];
  const pvByWeek = new Map(result.weeks.map((w) => [w.weekNumber, w.pointValue]));

  // Point-escalation table on the weeks themselves.
  for (const w of result.weeks) {
    const expected = w.weekNumber <= 18 ? 1 : { 19: 2, 20: 3, 21: 4, 22: 5 }[w.weekNumber];
    if (w.pointValue !== expected) {
      errors.push(`week ${w.weekNumber}: pointValue ${w.pointValue}, expected ${expected}`);
    }
  }

  // No team reused across the season, one pick per week, and correct grading.
  for (const player of result.players) {
    const pp = result.picks.filter((p) => p.userId === player.id);
    const seenTeams = new Set<string>();
    const seenWeeks = new Set<number>();
    for (const p of pp) {
      if (seenTeams.has(p.team)) errors.push(`${player.username} reused team ${p.team}`);
      seenTeams.add(p.team);
      if (seenWeeks.has(p.weekNumber)) errors.push(`${player.username} has two picks in week ${p.weekNumber}`);
      seenWeeks.add(p.weekNumber);

      if (p.result === "PENDING") errors.push(`${player.username} week ${p.weekNumber}: pick left PENDING`);
      const pv = pvByWeek.get(p.weekNumber)!;
      if (p.result === "WIN" && p.points !== pv) {
        errors.push(`${player.username} week ${p.weekNumber}: WIN worth ${p.points}, expected ${pv}`);
      }
      if (p.result === "LOSS" && p.points !== 0) {
        errors.push(`${player.username} week ${p.weekNumber}: LOSS worth ${p.points}, expected 0`);
      }
    }

    // Leaderboard total = sum of graded points = sum of week pointValues over wins.
    const total = pp.reduce((s, p) => s + p.points, 0);
    const expectedTotal = pp
      .filter((p) => p.result === "WIN")
      .reduce((s, p) => s + pvByWeek.get(p.weekNumber)!, 0);
    if (total !== expectedTotal) {
      errors.push(`${player.username}: total ${total} != sum of graded points ${expectedTotal}`);
    }
  }

  // Each playoff round actually produced a graded WIN, so the 2/3/4/5 path is
  // exercised end-to-end (not just asserted on the week definitions).
  for (const weekNumber of [19, 20, 21, 22]) {
    const wins = result.picks.filter((p) => p.weekNumber === weekNumber && p.result === "WIN");
    if (wins.length === 0) errors.push(`playoff week ${weekNumber}: no graded WIN — escalation path not exercised`);
  }

  // Trophy scores are valid win percentages.
  for (const t of result.trophy) {
    if (t.avgWinPct < 0 || t.avgWinPct > 1) errors.push(`team ${t.name}: avgWinPct ${t.avgWinPct} out of [0,1]`);
  }

  return errors;
}

// ---------- Logging (script mode) ----------

async function logWeek(
  prisma: PrismaClient,
  seasonId: string,
  week: SimWeekSpec,
  weekId: string,
  graded: number,
): Promise<void> {
  const label = week.isPlayoff ? `Week ${week.weekNumber} (playoff, ${week.pointValue}pt)` : `Week ${week.weekNumber}`;
  const picks = await prisma.pick.findMany({ where: { weekId }, include: { user: true } });
  const summary = picks
    .map((p) => `${p.user.username}:${p.team}=${p.result === "WIN" ? "✓" : p.result === "LOSS" ? "✗" : "·"}`)
    .join("  ");
  console.log(`\n▶ ${label} — ${week.games.length} games, ${picks.length} picks, ${graded} graded`);
  console.log(`  ${summary}`);

  // Running standings
  const all = await collectPicks(prisma, seasonId);
  const totals = new Map<string, number>();
  for (const p of all) totals.set(p.username, (totals.get(p.username) ?? 0) + p.points);
  const standings = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([u, pts]) => `${u} ${pts}`).join("  ");
  console.log(`  standings: ${standings}`);
}

// ---------- Disposable-DB helpers ----------

/** Throw unless `url` points at a clearly-disposable database (never the dev DB). */
export function assertSafeSimUrl(url: string): void {
  const dbName = new URL(url).pathname.slice(1);
  const devDbName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : null;
  const forbidden = new Set(["gfl", "postgres", "template0", "template1"]);
  if (devDbName) forbidden.add(devDbName);
  if (forbidden.has(dbName)) {
    throw new Error(
      `Refusing to run the season simulator against "${dbName}" — it must use a disposable DB (e.g. gfl_sim). ` +
        `Set SIM_DATABASE_URL to a throwaway database.`,
    );
  }
}

/** Drop + recreate the sim DB and run `migrate deploy` against it. */
export async function setupSimDatabase(url: string): Promise<void> {
  assertSafeSimUrl(url);
  const parsed = new URL(url);
  const dbName = parsed.pathname.slice(1);
  const adminConnStr = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port}/postgres`;

  const client = new pg.Client({ connectionString: adminConnStr });
  await client.connect();
  await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [dbName]);
  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execSync("pnpm prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}

// ---------- CLI entrypoint ----------

const DEFAULT_SIM_DB_URL = "postgresql://gfl:gfl_dev_password@localhost:5433/gfl_sim";

async function main(): Promise<void> {
  const url = process.env.SIM_DATABASE_URL ?? DEFAULT_SIM_DB_URL;
  const seed = process.env.SIM_SEED ? Number(process.env.SIM_SEED) : undefined;

  console.log(`Setting up disposable sim DB: ${url}`);
  await setupSimDatabase(url);

  const prisma = new PrismaClient({ adapter: new PrismaPg(url) });
  try {
    const result = await runSeasonSimulation(prisma, { seed, log: true });

    console.log("\n===== FINAL STANDINGS =====");
    const totals = new Map<string, number>();
    for (const p of result.picks) totals.set(p.username, (totals.get(p.username) ?? 0) + p.points);
    for (const [u, pts] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${u.padEnd(10)} ${pts}`);
    }
    console.log("\n===== TEAM TROPHY =====");
    for (const t of result.trophy) {
      console.log(`  ${t.name.padEnd(8)} ${(t.avgWinPct * 100).toFixed(1)}%  (${t.members.join(", ")})`);
    }

    const violations = checkInvariants(result);
    if (violations.length > 0) {
      console.error(`\n❌ ${violations.length} invariant violation(s):`);
      for (const v of violations) console.error(`  - ${v}`);
      process.exitCode = 1;
    } else {
      console.log("\n✅ All season invariants held.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only run the CLI when executed directly (not when imported by the test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
