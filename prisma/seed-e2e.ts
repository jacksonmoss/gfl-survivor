import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const dbUrl = process.env.DATABASE_URL!;
const adapter = new PrismaPg(dbUrl);
const prisma = new PrismaClient({ adapter });

// Fixture timeline for the E2E suite: weeks 1–3 are played (win, tie, loss for
// player1), week 4 is the current week the picks page auto-selects — it's the
// first week that still has a game before kickoff.
const now = new Date();
const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
// Beyond the 72h weather lookahead — an outdoor game this far out is never
// weather-fetched, so its card deterministically shows no forecast strip
// regardless of whether the mount sync can reach Open-Meteo.
const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

async function main() {
  const adminHash = await bcrypt.hash("admin123", 12);
  const playerHash = await bcrypt.hash("player123", 12);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: adminHash,
      displayName: "Admin",
      role: "ADMIN",
    },
  });

  // Invite code that player1 will "use" at creation time
  const usedInvite = await prisma.inviteCode.create({
    data: { code: "USED-BY-P1", createdBy: admin.id },
  });

  const player1 = await prisma.user.upsert({
    where: { username: "player1" },
    update: {},
    create: {
      username: "player1",
      passwordHash: playerHash,
      displayName: "Player One",
      email: "player1@example.com",
      inviteCodeUsed: usedInvite.code,
    },
  });

  // Second player — exists so the tied game below has a picker on *each* side
  // (#128). Both sides grade to a PUSH, and because the tie's game has kicked
  // off, player1 can see player2's pick on the leaderboard.
  const player2 = await prisma.user.upsert({
    where: { username: "player2" },
    update: {},
    create: {
      username: "player2",
      passwordHash: playerHash,
      displayName: "Player Two",
      email: "player2@example.com",
    },
  });

  // Fresh single-use invite codes for the registration tests (one per test that
  // consumes a code — single-use codes reject once used).
  for (const code of ["E2EINVITE1", "E2EINVITE2"]) {
    await prisma.inviteCode.upsert({
      where: { code },
      update: {},
      create: { code, createdBy: admin.id },
    });
  }

  // Reusable multi-use "league invite" (#110) — many users can register with it.
  await prisma.inviteCode.upsert({
    where: { code: "GFL-LEAGUE-E2E" },
    update: { multiUse: true, disabled: false },
    create: { code: "GFL-LEAGUE-E2E", createdBy: admin.id, multiUse: true },
  });

  const season = await prisma.season.upsert({
    where: { year: 2025 },
    update: { isActive: true },
    create: { year: 2025, isActive: true },
  });

  // Week 1 — already played (games in the past)
  const week1 = await prisma.week.upsert({
    where: { seasonId_weekNumber: { seasonId: season.id, weekNumber: 1 } },
    update: {},
    create: {
      seasonId: season.id,
      weekNumber: 1,
      label: "Week 1",
      pointValue: 1,
      pickDeadline: oneWeekAgo,
    },
  });

  const game1 = await prisma.game.upsert({
    where: { externalId: "e2e-game-w1-1" },
    update: {},
    create: {
      weekId: week1.id,
      homeTeam: "KC",
      awayTeam: "BUF",
      homeScore: 28,
      awayScore: 17,
      status: "FINAL",
      kickoff: oneWeekAgo,
      externalId: "e2e-game-w1-1",
    },
  });

  // player1 won week 1 by picking KC
  await prisma.pick.upsert({
    where: { userId_weekId: { userId: player1.id, weekId: week1.id } },
    update: {},
    create: {
      userId: player1.id,
      weekId: week1.id,
      team: "KC",
      result: "WIN",
      points: 1,
    },
  });

  // Week 2 — already played, and the tie fixture (#128): TEN vs JAX ended level,
  // so both pickers are graded PUSH (0 points, not a win). player1 picked the
  // home side and player2 the away side, which drives the tie UI assertions:
  // "Tied" in the season-picks table + current-pick card, "=" / sr-only "Tie" on
  // the leaderboard, and a win% that ignores the push (player1 is 1W/1T/1L → 50%).
  const week2 = await prisma.week.upsert({
    where: { seasonId_weekNumber: { seasonId: season.id, weekNumber: 2 } },
    update: {},
    create: {
      seasonId: season.id,
      weekNumber: 2,
      label: "Week 2",
      pointValue: 1,
      pickDeadline: sixDaysAgo,
    },
  });

  await prisma.game.upsert({
    where: { externalId: "e2e-game-w2-1" },
    update: {},
    create: {
      weekId: week2.id,
      homeTeam: "TEN",
      awayTeam: "JAX",
      homeScore: 20,
      awayScore: 20,
      status: "FINAL",
      kickoff: sixDaysAgo,
      externalId: "e2e-game-w2-1",
    },
  });

  for (const [user, team] of [[player1, "TEN"], [player2, "JAX"]] as const) {
    await prisma.pick.upsert({
      where: { userId_weekId: { userId: user.id, weekId: week2.id } },
      update: {},
      create: {
        userId: user.id,
        weekId: week2.id,
        team,
        result: "PUSH",
        points: 0,
      },
    });
  }

  // Week 3 — already played: player1 lost, so the leaderboard has a real
  // loss alongside the week-1 win and the week-2 push (1W/1T/1L).
  const week3 = await prisma.week.upsert({
    where: { seasonId_weekNumber: { seasonId: season.id, weekNumber: 3 } },
    update: {},
    create: {
      seasonId: season.id,
      weekNumber: 3,
      label: "Week 3",
      pointValue: 1,
      pickDeadline: fiveDaysAgo,
    },
  });

  await prisma.game.upsert({
    where: { externalId: "e2e-game-w3-1" },
    update: {},
    create: {
      weekId: week3.id,
      homeTeam: "PHI",
      awayTeam: "NYG",
      homeScore: 27,
      awayScore: 10,
      status: "FINAL",
      kickoff: fiveDaysAgo,
      externalId: "e2e-game-w3-1",
    },
  });

  await prisma.pick.upsert({
    where: { userId_weekId: { userId: player1.id, weekId: week3.id } },
    update: {},
    create: {
      userId: player1.id,
      weekId: week3.id,
      team: "NYG",
      result: "LOSS",
      points: 0,
    },
  });

  // Week 4 — current week: one game already started (locked), two future
  const week4 = await prisma.week.upsert({
    where: { seasonId_weekNumber: { seasonId: season.id, weekNumber: 4 } },
    update: {},
    create: {
      seasonId: season.id,
      weekNumber: 4,
      label: "Week 4",
      pointValue: 1,
      pickDeadline: threeDaysFromNow,
    },
  });

  // LAR vs SEA: kicked off 2 hours ago → locked for new picks
  await prisma.game.upsert({
    where: { externalId: "e2e-game-w4-1" },
    update: {},
    create: {
      weekId: week4.id,
      homeTeam: "LAR",
      awayTeam: "SEA",
      status: "LIVE",
      kickoff: twoHoursAgo,
      externalId: "e2e-game-w4-1",
    },
  });

  // SF vs DAL: outdoor (Levi's Stadium), kicks off in 5 days → can still pick.
  // Beyond the 72h weather window and left without cached weatherJson, so its
  // card renders no forecast strip (the "outdoor, no weather" fixture for #69).
  await prisma.game.upsert({
    where: { externalId: "e2e-game-w4-2" },
    update: {},
    create: {
      weekId: week4.id,
      homeTeam: "SF",
      awayTeam: "DAL",
      status: "SCHEDULED",
      kickoff: fiveDaysFromNow,
      externalId: "e2e-game-w4-2",
    },
  });

  // GB vs CHI: outdoor (Lambeau Field), kicks off in 2 days, seeded with a
  // deterministic forecast so the weather strip is asserted without any network
  // dependency. fetched_at = now keeps the mount sync's ~3h cache gate from
  // re-fetching and overwriting it. (LAR vs SEA above is the dome fixture: SoFi
  // is indoor, so that card shows "🏟️ Dome" with no seeded weather.)
  //
  // Also carries a seeded spreadHome (GB favored by 6.5) so the betting-spread
  // strip is asserted deterministically without any Odds API call (#72): the
  // home side shows "-6.5", the away side "+6.5". SF vs DAL above is left with
  // spreadHome null as the graceful-absent fixture (no strip).
  await prisma.game.upsert({
    where: { externalId: "e2e-game-w4-3" },
    update: {},
    create: {
      weekId: week4.id,
      homeTeam: "GB",
      awayTeam: "CHI",
      status: "SCHEDULED",
      kickoff: twoDaysFromNow,
      externalId: "e2e-game-w4-3",
      spreadHome: -6.5,
      weatherJson: {
        temp_f: 41,
        wind_mph: 22,
        wind_dir: "NW",
        precip_chance: 70,
        code: 3,
        fetched_at: now.toISOString(),
      },
    },
  });

  // A week-4 pick on a game that has NOT kicked off (SF vs DAL is 5 days out).
  // This is the stats-page leak fixture (#121): week 4 is incomplete, so it must
  // not appear in the week selector, and "DAL" must not surface anywhere in the
  // stats — not as a most-picked team, not in a digest.
  await prisma.pick.upsert({
    where: { userId_weekId: { userId: player2.id, weekId: week4.id } },
    update: {},
    create: {
      userId: player2.id,
      weekId: week4.id,
      team: "DAL",
      result: "PENDING",
      points: 0,
    },
  });

  // Suppress unused-variable warnings — game1 id not needed after upsert
  void game1;

  console.log("E2E seed complete.");
  console.log("  admin / admin123");
  console.log("  player1 / player123  (wk1 win, wk2 tie, wk3 loss)");
  console.log("  player2 / player123  (wk2 tie — other side of TEN/JAX; wk4 DAL, pre-kickoff)");
  console.log("  Invite code for registration test: E2EINVITE1");
  console.log("  Season 2025 active, weeks 1–4 seeded (1–3 played, 4 current)");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
