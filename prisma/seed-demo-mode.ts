import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { buildSeasonWeeks } from "../src/lib/season";
import { NFL_TEAMS } from "../src/lib/nfl-teams";

// Demo-mode seed (#161, four weeks in #163): a league sitting at the very start
// of the 2026 season, with the first four weeks scheduled.
//
// Where `seed-demo.ts` hands the customer a league mid-flight (weeks 1–3 already
// graded), this one starts them at kickoff of week 1 with **nobody having picked
// anything** — which is the state the one-click simulation is designed around.
// The customer makes the first pick in the league, presses "Simulate week" (or
// "Simulate 4 weeks") on the picks page, and watches the loop close.
//
// Four weeks rather than one because a single week can't show a season: with
// four, the standings move, streaks build, lead changes appear on the stats
// page, and each player's pool of unused teams visibly shrinks.
//
// Pair it with DEMO_MODE=true (docker-compose.beta.yml sets it by default):
//   ./scripts/beta.sh seed demo-mode
//
// The games are fabricated, not imported from ESPN — a demo must not depend on
// an upstream API being reachable, and it has to work whatever the real
// schedule looks like on the day. They carry no externalId, so "Sync Live
// Scores" ignores them (same as the `demo` seed).

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const SEASON_YEAR = 2026;
/** How many weeks get a slate. Four is what the demo panel offers in one run. */
const SCHEDULED_WEEKS = 4;

type Slot = "THU" | "SUN_EARLY" | "SUN_LATE" | "SUN_NIGHT" | "MON";

// Week 1 is hand-written so the opener looks like a real week 1 (a marquee
// Thursday game, sensible divisional matchups). Later weeks are generated —
// see rotatedSlate. `spread` is the home line (negative = home favoured), same
// convention as Game.spreadHome; a game without a line exercises the
// "no odds posted" path.
const WEEK1_GAMES: { away: string; home: string; spread: number | null }[] = [
  { away: "BAL", home: "KC", spread: -2.5 },
  { away: "NYJ", home: "BUF", spread: -6.5 },
  { away: "CAR", home: "ATL", spread: -3 },
  { away: "TEN", home: "HOU", spread: -7 },
  { away: "NE", home: "MIA", spread: -1.5 },
  { away: "CHI", home: "GB", spread: -4.5 },
  { away: "CLE", home: "PIT", spread: -5 },
  { away: "JAX", home: "IND", spread: -2 },
  { away: "NO", home: "TB", spread: -3.5 },
  { away: "WAS", home: "NYG", spread: 1.5 },
  { away: "ARI", home: "SEA", spread: -3 },
  { away: "DEN", home: "LAC", spread: -1 },
  { away: "MIN", home: "DET", spread: -5.5 },
  { away: "LV", home: "SF", spread: -8.5 },
  { away: "PHI", home: "DAL", spread: 2.5 },
  { away: "CIN", home: "LAR", spread: null },
];

// Which window each game of a 16-game slate falls in: a Thursday opener, the
// two Sunday afternoon windows, Sunday night, and Monday night.
const SLOTS: Slot[] = [
  "THU",
  ...Array<Slot>(8).fill("SUN_EARLY"),
  ...Array<Slot>(4).fill("SUN_LATE"),
  ...Array<Slot>(2).fill("SUN_NIGHT"),
  "MON",
];

// Home lines cycled through the generated weeks. The last entry is null so
// every week has exactly one game with no line posted.
const SPREAD_CYCLE: (number | null)[] = [-3, -6.5, 1.5, -1, -4.5, 2.5, -7, -2, 3.5, -1.5, -5.5, 4, -2.5, -9, 1, null];

const ALL_TEAMS = NFL_TEAMS.map((t) => t.abbr);

/**
 * A full 16-game slate for a later week: fix the first team, rotate the other
 * 31 by the week number, pair them off. Round-robin, so all 32 teams appear
 * exactly once and no week repeats a matchup. Same construction the season
 * simulator uses (prisma/sim-season.ts).
 */
function rotatedSlate(weekNumber: number): { away: string; home: string; spread: number | null }[] {
  const fixed = ALL_TEAMS[0];
  const pool = ALL_TEAMS.slice(1);
  const offset = (weekNumber - 1) % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];

  const pairs: [string, string][] = [[fixed, rotated[rotated.length - 1]]];
  for (let i = 0; i < (ALL_TEAMS.length - 2) / 2; i++) {
    pairs.push([rotated[i], rotated[rotated.length - 2 - i]]);
  }

  return pairs.map(([home, away], i) => ({
    home,
    away,
    spread: SPREAD_CYCLE[(i + weekNumber) % SPREAD_CYCLE.length],
  }));
}

const PLAYERS = [
  { username: "jdog", displayName: "Jackson", realName: "Jackson Moss", team: "The Dawgs" },
  { username: "mike_t", displayName: "Mike T", realName: "Mike Thompson", team: "The Dawgs" },
  { username: "sara_k", displayName: "Sara", realName: "Sara Kim", team: "The Dawgs" },
  { username: "bigben", displayName: "Ben", realName: "Ben Carter", team: "Gridiron Gang" },
  { username: "chadwick", displayName: "Chad", realName: "Chad Wick", team: "Gridiron Gang" },
  { username: "tommy_b", displayName: "Tommy", realName: "Tommy Burke", team: "Gridiron Gang" },
  { username: "lucky13", displayName: "Lucky", realName: null, team: "Lone Wolves" },
  { username: "ace_v", displayName: "Ace", realName: "Ace Valdez", team: "Lone Wolves" },
  { username: "queenb", displayName: "Bri", realName: "Bri Queen", team: null },
  { username: "zeke99", displayName: "Zeke", realName: null, team: null },
];

/**
 * The Thursday week 1 opens on: the next real Thursday at least two days out,
 * so the slate reads as a genuine upcoming week and nothing is locked when the
 * customer arrives — whatever day the demo is seeded on.
 */
function firstThursday(): Date {
  const thu = new Date();
  thu.setDate(thu.getDate() + 2);
  thu.setHours(20, 15, 0, 0);
  while (thu.getDay() !== 4) thu.setDate(thu.getDate() + 1); // 4 = Thursday
  return thu;
}

/** Kickoff for a slot in a given week: week 1's Thursday plus whole weeks. */
function kickoffFor(opener: Date, weekNumber: number, slot: Slot): Date {
  const offsets: Record<Slot, [days: number, hour: number, minute: number]> = {
    THU: [0, 20, 15],
    SUN_EARLY: [3, 13, 0],
    SUN_LATE: [3, 16, 25],
    SUN_NIGHT: [3, 20, 20],
    MON: [4, 20, 15],
  };
  const [days, hour, minute] = offsets[slot];
  const d = new Date(opener);
  d.setDate(d.getDate() + (weekNumber - 1) * 7 + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  console.log("Clearing existing data...");
  await prisma.pick.deleteMany();
  await prisma.game.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.week.deleteMany();
  await prisma.teamMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.user.deleteMany({ where: { role: "PLAYER" } });
  await prisma.team.deleteMany();

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: await bcrypt.hash("admin123", 12),
      displayName: "Admin",
      role: "ADMIN",
    },
  });

  const invites = [];
  for (let i = 0; i < 15; i++) {
    invites.push(await prisma.inviteCode.create({ data: { createdBy: admin.id } }));
  }

  const teamIds = new Map<string, string>();
  for (const name of [...new Set(PLAYERS.map((p) => p.team).filter(Boolean))] as string[]) {
    const team = await prisma.team.create({ data: { name } });
    teamIds.set(name, team.id);
  }

  const playerHash = await bcrypt.hash("password", 12);
  const userIds = new Map<string, string>();
  for (const [i, p] of PLAYERS.entries()) {
    const user = await prisma.user.create({
      data: {
        username: p.username,
        passwordHash: playerHash,
        displayName: p.displayName,
        realName: p.realName,
        role: "PLAYER",
        inviteCodeUsed: invites[i].code,
      },
    });
    userIds.set(p.username, user.id);
  }

  // Full 22-week season from the same builder the admin panel uses, so the
  // playoff rounds and their point escalation are real, not demo-only.
  const season = await prisma.season.create({
    data: {
      year: SEASON_YEAR,
      isActive: true,
      weeks: { create: buildSeasonWeeks(SEASON_YEAR) },
    },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });

  await prisma.teamMembership.createMany({
    data: PLAYERS.filter((p) => p.team).map((p) => ({
      userId: userIds.get(p.username)!,
      seasonId: season.id,
      teamId: teamIds.get(p.team!)!,
    })),
  });

  const opener = firstThursday();
  for (let weekNumber = 1; weekNumber <= SCHEDULED_WEEKS; weekNumber++) {
    const games = weekNumber === 1 ? WEEK1_GAMES : rotatedSlate(weekNumber);
    const week = season.weeks[weekNumber - 1];

    for (const [i, game] of games.entries()) {
      await prisma.game.create({
        data: {
          weekId: week.id,
          homeTeam: game.home,
          awayTeam: game.away,
          status: "SCHEDULED",
          kickoff: kickoffFor(opener, weekNumber, SLOTS[i]),
          spreadHome: game.spread,
        },
      });
    }

    await prisma.week.update({
      where: { id: week.id },
      data: { pickDeadline: kickoffFor(opener, weekNumber, "THU") },
    });
    console.log(`Week ${weekNumber}: ${games.length} games, opener ${kickoffFor(opener, weekNumber, "THU").toLocaleString()}`);
  }

  console.log(`\n--- ${SEASON_YEAR} weeks 1–${SCHEDULED_WEEKS}, ready to play ---`);
  console.log(`Players: ${PLAYERS.length} (+ admin), teams: ${[...teamIds.keys()].join(", ")}`);
  console.log("Picks: none — the league starts empty on purpose");
  console.log("\nAdmin: admin / admin123   Players: password");
  console.log('Next: log in, pick a team for week 1, then press "Simulate week"');
  console.log(`(or "Simulate ${SCHEDULED_WEEKS} weeks") on the picks page.`);
  console.log("Those buttons only appear with DEMO_MODE=true.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
