import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { buildSeasonWeeks } from "../src/lib/season";

// Demo-mode seed (#161): a league sitting at the very start of the 2026 season.
//
// Where `seed-demo.ts` hands the customer a league mid-flight (weeks 1–3 already
// graded), this one starts them at kickoff of week 1 with **nobody having picked
// anything** — which is the state the one-click week simulation is designed
// around. The customer makes the first pick in the league, presses "Simulate
// week" on the picks page, and watches the loop close.
//
// Pair it with DEMO_MODE=true (docker-compose.beta.yml sets it by default):
//   ./scripts/beta.sh seed week1
//
// The games are fabricated, not imported from ESPN — a demo must not depend on
// an upstream API being reachable, and it has to work whatever the real
// schedule looks like on the day. They carry no externalId, so "Sync Live
// Scores" ignores them (same as the `demo` seed).

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const SEASON_YEAR = 2026;

// A full week-1 slate: 16 games, all 32 teams exactly once.
// `slot` places the game in the real NFL rhythm — Thursday night opener, three
// Sunday windows, Monday night. `spread` is the home line (negative = home
// favoured), same convention as Game.spreadHome; one game is deliberately
// without a line so the "no odds posted" path shows up.
const WEEK1_GAMES: {
  away: string;
  home: string;
  slot: "THU" | "SUN_EARLY" | "SUN_LATE" | "SUN_NIGHT" | "MON";
  spread: number | null;
}[] = [
  { away: "BAL", home: "KC", slot: "THU", spread: -2.5 },
  { away: "NYJ", home: "BUF", slot: "SUN_EARLY", spread: -6.5 },
  { away: "CAR", home: "ATL", slot: "SUN_EARLY", spread: -3 },
  { away: "TEN", home: "HOU", slot: "SUN_EARLY", spread: -7 },
  { away: "NE", home: "MIA", slot: "SUN_EARLY", spread: -1.5 },
  { away: "CHI", home: "GB", slot: "SUN_EARLY", spread: -4.5 },
  { away: "CLE", home: "PIT", slot: "SUN_EARLY", spread: -5 },
  { away: "JAX", home: "IND", slot: "SUN_EARLY", spread: -2 },
  { away: "NO", home: "TB", slot: "SUN_EARLY", spread: -3.5 },
  { away: "WAS", home: "NYG", slot: "SUN_LATE", spread: 1.5 },
  { away: "ARI", home: "SEA", slot: "SUN_LATE", spread: -3 },
  { away: "DEN", home: "LAC", slot: "SUN_LATE", spread: -1 },
  { away: "MIN", home: "DET", slot: "SUN_LATE", spread: -5.5 },
  { away: "LV", home: "SF", slot: "SUN_NIGHT", spread: -8.5 },
  { away: "PHI", home: "DAL", slot: "SUN_NIGHT", spread: 2.5 },
  { away: "CIN", home: "LAR", slot: "MON", spread: null },
];

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
 * Kickoff times anchored on the next real Thursday at least two days out, so
 * the slate reads as a genuine upcoming week (Thu night / Sun windows / Mon
 * night) and nothing is locked when the customer arrives — whatever day the
 * demo is seeded on.
 */
function kickoffs(): Record<(typeof WEEK1_GAMES)[number]["slot"], Date> {
  const thu = new Date();
  thu.setDate(thu.getDate() + 2);
  thu.setHours(20, 15, 0, 0);
  while (thu.getDay() !== 4) thu.setDate(thu.getDate() + 1); // 4 = Thursday

  const at = (dayOffset: number, hour: number, minute: number) => {
    const d = new Date(thu);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  return {
    THU: new Date(thu),
    SUN_EARLY: at(3, 13, 0),
    SUN_LATE: at(3, 16, 25),
    SUN_NIGHT: at(3, 20, 20),
    MON: at(4, 20, 15),
  };
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

  const slots = kickoffs();
  const week1 = season.weeks[0];
  for (const game of WEEK1_GAMES) {
    await prisma.game.create({
      data: {
        weekId: week1.id,
        homeTeam: game.home,
        awayTeam: game.away,
        status: "SCHEDULED",
        kickoff: slots[game.slot],
        spreadHome: game.spread,
      },
    });
  }
  await prisma.week.update({
    where: { id: week1.id },
    data: { pickDeadline: slots.THU },
  });

  console.log(`\n--- ${SEASON_YEAR} week 1, ready to play ---`);
  console.log(`Players: ${PLAYERS.length} (+ admin), teams: ${[...teamIds.keys()].join(", ")}`);
  console.log(`Week 1: ${WEEK1_GAMES.length} games, opener ${slots.THU.toLocaleString()}`);
  console.log("Picks: none — the league starts empty on purpose");
  console.log("\nAdmin: admin / admin123   Players: password");
  console.log("Next: log in, pick a team for week 1, then press \"Simulate week\" on the picks page.");
  console.log("(That button only appears with DEMO_MODE=true.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
