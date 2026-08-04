import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// Realistic NFL schedule data for first 3 weeks.
//
// `spread` is the closing home-team line (negative = home favored), same
// convention as Game.spreadHome. Completed weeks carry lines so the stats page
// (#121) can identify upsets; a couple of games are left `null` each week to
// exercise the "no odds posted, skip it" path. The signs are chosen so the
// favorite usually covers — the deliberate upsets are:
//   wk1  KC (+3) over BAL      — the week's consensus pick, 4 players burned
//   wk2  ATL (+4.5) at PHI     — again the consensus pick, 4 burned
//   wk2  NO (+3) at DAL        — burns lucky13
//   wk3  BAL (+2.5) over DAL   — burns the two co-leaders
//   wk3  WAS (+2.5) at CIN     — nobody on it either way
const WEEK_GAMES = [
  {
    weekNumber: 1,
    games: [
      { away: "BAL", home: "KC", awayScore: 20, homeScore: 27, day: "Thu", hour: 20, spread: 3 },
      { away: "PIT", home: "ATL", awayScore: 18, homeScore: 10, day: "Sun", hour: 13, spread: 2.5 },
      { away: "ARI", home: "BUF", awayScore: 21, homeScore: 34, day: "Sun", hour: 13, spread: -6.5 },
      { away: "TEN", home: "CHI", awayScore: 17, homeScore: 24, day: "Sun", hour: 13, spread: -3 },
      { away: "JAX", home: "MIA", awayScore: 17, homeScore: 20, day: "Sun", hour: 13, spread: -3.5 },
      { away: "CAR", home: "NO", awayScore: 10, homeScore: 47, day: "Sun", hour: 13, spread: -5.5 },
      { away: "MIN", home: "NYG", awayScore: 28, homeScore: 6, day: "Sun", hour: 13, spread: 1 },
      { away: "HOU", home: "IND", awayScore: 29, homeScore: 27, day: "Sun", hour: 13, spread: 2 },
      { away: "CIN", home: "NE", awayScore: 16, homeScore: 10, day: "Sun", hour: 13, spread: 7.5 },
      { away: "CLE", home: "DAL", awayScore: 17, homeScore: 33, day: "Sun", hour: 16, spread: -3 },
      { away: "LV", home: "LAC", awayScore: 22, homeScore: 10, day: "Sun", hour: 16, spread: 3 },
      { away: "DEN", home: "SEA", awayScore: 20, homeScore: 26, day: "Sun", hour: 16, spread: -5.5 },
      { away: "WAS", home: "TB", awayScore: 20, homeScore: 37, day: "Sun", hour: 16, spread: -4 },
      { away: "GB", home: "PHI", awayScore: 29, homeScore: 34, day: "Sun", hour: 16, spread: -1.5 },
      { away: "LAR", home: "DET", awayScore: 20, homeScore: 26, day: "Sun", hour: 20, spread: -3.5 },
      { away: "NYJ", home: "SF", awayScore: 13, homeScore: 32, day: "Mon", hour: 20, spread: null },
    ],
  },
  {
    weekNumber: 2,
    games: [
      { away: "BUF", home: "MIA", awayScore: 31, homeScore: 10, day: "Thu", hour: 20, spread: 1.5 },
      { away: "NO", home: "DAL", awayScore: 44, homeScore: 19, day: "Sun", hour: 13, spread: -3 },
      { away: "TB", home: "DET", awayScore: 16, homeScore: 20, day: "Sun", hour: 13, spread: -2.5 },
      { away: "IND", home: "GB", awayScore: 10, homeScore: 16, day: "Sun", hour: 13, spread: -6 },
      { away: "SF", home: "MIN", awayScore: 17, homeScore: 23, day: "Sun", hour: 13, spread: -1.5 },
      { away: "NYJ", home: "TEN", awayScore: 24, homeScore: 17, day: "Sun", hour: 13, spread: 3 },
      { away: "SEA", home: "NE", awayScore: 23, homeScore: 20, day: "Sun", hour: 13, spread: 2.5 },
      { away: "LAC", home: "CAR", awayScore: 26, homeScore: 3, day: "Sun", hour: 13, spread: 5.5 },
      { away: "CLE", home: "JAX", awayScore: 18, homeScore: 13, day: "Sun", hour: 13, spread: 1.5 },
      { away: "LAR", home: "ARI", awayScore: 41, homeScore: 10, day: "Sun", hour: 16, spread: 4 },
      { away: "PIT", home: "DEN", awayScore: 6, homeScore: 13, day: "Sun", hour: 16, spread: -1.5 },
      { away: "NYG", home: "WAS", awayScore: 18, homeScore: 21, day: "Sun", hour: 16, spread: -3 },
      { away: "CIN", home: "KC", awayScore: 25, homeScore: 26, day: "Sun", hour: 16, spread: -6 },
      { away: "BAL", home: "LV", awayScore: 23, homeScore: 26, day: "Sun", hour: 20, spread: -1 },
      { away: "CHI", home: "HOU", awayScore: 19, homeScore: 13, day: "Sun", hour: 20, spread: null },
      { away: "ATL", home: "PHI", awayScore: 22, homeScore: 21, day: "Mon", hour: 20, spread: -4.5 },
    ],
  },
  {
    weekNumber: 3,
    games: [
      { away: "NYJ", home: "NE", awayScore: 3, homeScore: 3, day: "Thu", hour: 20, spread: -1.5 },
      { away: "PHI", home: "NO", awayScore: 15, homeScore: 12, day: "Sun", hour: 13, spread: 1.5 },
      { away: "DEN", home: "TB", awayScore: 7, homeScore: 26, day: "Sun", hour: 13, spread: -3.5 },
      { away: "NYG", home: "CLE", awayScore: 21, homeScore: 15, day: "Sun", hour: 13, spread: 3 },
      { away: "MIN", home: "HOU", awayScore: 7, homeScore: 30, day: "Sun", hour: 13, spread: -6 },
      { away: "GB", home: "TEN", awayScore: 30, homeScore: 14, day: "Sun", hour: 13, spread: 7 },
      { away: "CHI", home: "IND", awayScore: 16, homeScore: 21, day: "Sun", hour: 13, spread: -2.5 },
      { away: "LAC", home: "PIT", awayScore: 10, homeScore: 20, day: "Sun", hour: 13, spread: -3 },
      { away: "DAL", home: "BAL", awayScore: 25, homeScore: 28, day: "Sun", hour: 16, spread: 2.5 },
      { away: "MIA", home: "SEA", awayScore: 3, homeScore: 24, day: "Sun", hour: 16, spread: -6.5 },
      { away: "SF", home: "LAR", awayScore: 27, homeScore: 24, day: "Sun", hour: 16, spread: 2 },
      { away: "CAR", home: "LV", awayScore: 22, homeScore: 36, day: "Sun", hour: 16, spread: null },
      { away: "KC", home: "ATL", awayScore: 22, homeScore: 17, day: "Sun", hour: 20, spread: 3 },
      { away: "DET", home: "ARI", awayScore: 20, homeScore: 13, day: "Sun", hour: 20, spread: 3.5 },
      { away: "JAX", home: "BUF", awayScore: 10, homeScore: 47, day: "Mon", hour: 20, spread: -9 },
      { away: "WAS", home: "CIN", awayScore: 38, homeScore: 33, day: "Mon", hour: 20, spread: -2.5 },
    ],
  },
];

const PLAYER_NAMES = [
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

// Which teams each player picked for weeks 1-3. Deliberately mixed so the
// leaderboard *and* the stats page (#121) have something to show: a heavy
// consensus that busts in weeks 1 and 2, a tie, a lead change every week, and
// a leader who takes a loss.
//
//   wk1  BAL is the consensus (4 picks) and loses to KC — jdog alone cashes
//   wk2  PHI is the consensus (4 picks) and loses to ATL; lucky13 also busts on DAL
//   wk3  HOU is a clean 2-player sweep, DAL a 2-player whiff that knocks both
//        co-leaders (jdog, queenb) off the top and snaps their 2-game streaks;
//        mike_t's NYJ pick lands on the NYJ/NE tie, so it grades PUSH
//
// Nobody repeats a team — the no-reuse rule is enforced at pick time, so a
// duplicate here would silently drop a pick.
const PLAYER_PICKS: Record<string, string[]> = {
  jdog:     ["KC",  "BUF", "DAL"],
  mike_t:   ["BAL", "DET", "NYJ"],
  sara_k:   ["BAL", "PHI", "HOU"],
  bigben:   ["BAL", "PHI", "HOU"],
  chadwick: ["BAL", "SEA", "PIT"],
  tommy_b:  ["SF",  "PHI", "KC"],
  lucky13:  ["TB",  "DAL", "BUF"],
  ace_v:    ["NO",  "GB",  "SEA"],
  queenb:   ["MIN", "LAC", "DAL"],
  zeke99:   ["DET", "PHI", "TB"],
};

function getWeekDate(weekNum: number, dayOfWeek: string, hour: number): Date {
  // Season starts Sept 2025
  const weekStart = new Date(2025, 8, 4); // Sept 4, 2025 (Thursday Week 1)
  const dayOffset: Record<string, number> = { Thu: 0, Sun: 3, Mon: 4 };
  const d = new Date(weekStart);
  d.setDate(d.getDate() + (weekNum - 1) * 7 + (dayOffset[dayOfWeek] ?? 0));
  d.setHours(hour, 0, 0, 0);
  return d;
}

function determinePickResult(
  team: string,
  games: typeof WEEK_GAMES[0]["games"]
): { result: "WIN" | "LOSS" | "PUSH"; } {
  const game = games.find((g) => g.home === team || g.away === team);
  if (!game) return { result: "LOSS" };

  if (game.homeScore === game.awayScore) return { result: "PUSH" };

  const homeWon = game.homeScore > game.awayScore;
  const pickedHome = game.home === team;
  return { result: (pickedHome === homeWon) ? "WIN" : "LOSS" };
}

async function main() {
  console.log("Clearing existing data...");
  await prisma.pick.deleteMany();
  await prisma.game.deleteMany();
  await prisma.week.deleteMany();
  await prisma.teamMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.user.deleteMany({ where: { role: "PLAYER" } });
  await prisma.team.deleteMany();

  // Ensure admin exists
  const passwordHash = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
      displayName: "Admin",
      role: "ADMIN",
    },
  });

  // Create invite codes
  const invites = [];
  for (let i = 0; i < 15; i++) {
    const invite = await prisma.inviteCode.create({
      data: { createdBy: admin.id },
    });
    invites.push(invite);
  }

  // Create teams
  const teamMap = new Map<string, string>();
  const teamNames = [...new Set(PLAYER_NAMES.map((p) => p.team).filter(Boolean))] as string[];
  for (const name of teamNames) {
    const team = await prisma.team.create({ data: { name } });
    teamMap.set(name, team.id);
  }

  // Create players
  const playerHash = await bcrypt.hash("password", 12);
  const players = new Map<string, string>();
  let inviteIdx = 0;

  for (const p of PLAYER_NAMES) {
    const invite = invites[inviteIdx++];
    const user = await prisma.user.create({
      data: {
        username: p.username,
        passwordHash: playerHash,
        displayName: p.displayName,
        realName: p.realName ?? null,
        role: "PLAYER",
        inviteCodeUsed: invite.code,
      },
    });
    players.set(p.username, user.id);
  }

  console.log(`Created ${players.size} players (password: "password" for all)`);

  // Create season
  const season = await prisma.season.create({
    data: { year: 2025, isActive: true },
  });

  // Season-scoped roster memberships (#120): assign each player to their team
  // for this season.
  await prisma.teamMembership.createMany({
    data: PLAYER_NAMES.filter((p) => p.team).map((p) => ({
      userId: players.get(p.username)!,
      seasonId: season.id,
      teamId: teamMap.get(p.team!)!,
    })),
  });

  // Create all 22 weeks
  const weeks = [];
  for (let w = 1; w <= 18; w++) {
    const firstGame = getWeekDate(w, "Thu", 20);
    const week = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber: w,
        label: `Week ${w}`,
        isPlayoff: false,
        pointValue: 1,
        pickDeadline: firstGame,
      },
    });
    weeks.push(week);
  }

  const playoffRounds = [
    { num: 19, label: "Wild Card", pts: 2, date: new Date(2026, 0, 10, 13) },
    { num: 20, label: "Divisional", pts: 3, date: new Date(2026, 0, 17, 13) },
    { num: 21, label: "Conference Championship", pts: 4, date: new Date(2026, 0, 25, 15) },
    { num: 22, label: "Super Bowl", pts: 5, date: new Date(2026, 1, 8, 18) },
  ];

  for (const pr of playoffRounds) {
    const week = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber: pr.num,
        label: pr.label,
        isPlayoff: true,
        pointValue: pr.pts,
        pickDeadline: pr.date,
      },
    });
    weeks.push(week);
  }

  console.log(`Created ${weeks.length} weeks for 2025 season`);

  // Add games for weeks 1-3
  for (const weekData of WEEK_GAMES) {
    const week = weeks[weekData.weekNumber - 1];
    for (const game of weekData.games) {
      await prisma.game.create({
        data: {
          weekId: week.id,
          homeTeam: game.home,
          awayTeam: game.away,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          status: "FINAL",
          kickoff: getWeekDate(weekData.weekNumber, game.day, game.hour),
          spreadHome: game.spread,
        },
      });
    }
    console.log(`Added ${weekData.games.length} games for Week ${weekData.weekNumber}`);
  }

  // Add games for week 4 (upcoming, no scores yet — future kickoffs).
  // `spread` is the demo home-team line (negative = home favored); one game is
  // left without a spread to exercise the "gracefully absent" path.
  const week4Games = [
    { away: "DAL", home: "NYG", day: "Thu", hour: 20, spread: 3.5 },
    { away: "NO", home: "ATL", day: "Sun", hour: 13, spread: -6.5 },
    { away: "CIN", home: "CAR", day: "Sun", hour: 13, spread: 4 },
    { away: "JAX", home: "HOU", day: "Sun", hour: 13, spread: -2.5 },
    { away: "DEN", home: "NYJ", day: "Sun", hour: 13, spread: 1.5 },
    { away: "MIN", home: "GB", day: "Sun", hour: 13, spread: -3 },
    { away: "PIT", home: "IND", day: "Sun", hour: 13, spread: 0 },
    { away: "TB", home: "PHI", day: "Sun", hour: 13, spread: -5.5 },
    { away: "WAS", home: "ARI", day: "Sun", hour: 16, spread: 2.5 },
    { away: "NE", home: "SF", day: "Sun", hour: 16, spread: -7 },
    { away: "CLE", home: "LV", day: "Sun", hour: 16, spread: -1.5 },
    { away: "KC", home: "LAC", day: "Sun", hour: 16, spread: 2.5 },
    { away: "BUF", home: "BAL", day: "Sun", hour: 20, spread: 1 },
    { away: "TEN", home: "MIA", day: "Mon", hour: 20, spread: -3.5 },
    { away: "SEA", home: "DET", day: "Mon", hour: 20, spread: -4.5 },
    { away: "CHI", home: "LAR", day: "Mon", hour: 20 }, // no line — degrades gracefully
  ];

  const week4 = weeks[3];
  // Set kickoffs far in the future so they're pickable
  for (const game of week4Games) {
    const kickoff = new Date();
    kickoff.setDate(kickoff.getDate() + 3); // 3 days from now
    const dayOffset: Record<string, number> = { Thu: 0, Sun: 3, Mon: 4 };
    kickoff.setDate(kickoff.getDate() + (dayOffset[game.day] ?? 0));
    kickoff.setHours(game.hour, 0, 0, 0);

    await prisma.game.create({
      data: {
        weekId: week4.id,
        homeTeam: game.home,
        awayTeam: game.away,
        status: "SCHEDULED",
        kickoff,
        spreadHome: game.spread ?? null,
      },
    });
  }
  // Update week 4 deadline to be in the future
  const week4Deadline = new Date();
  week4Deadline.setDate(week4Deadline.getDate() + 3);
  week4Deadline.setHours(20, 0, 0, 0);
  await prisma.week.update({
    where: { id: week4.id },
    data: { pickDeadline: week4Deadline },
  });
  console.log(`Added ${week4Games.length} scheduled games for Week 4 (upcoming)`);

  // Create picks for weeks 1-3
  for (const [username, teamPicks] of Object.entries(PLAYER_PICKS)) {
    const userId = players.get(username);
    if (!userId) continue;

    for (let w = 0; w < teamPicks.length; w++) {
      const week = weeks[w];
      const team = teamPicks[w];
      const weekData = WEEK_GAMES[w];
      const { result } = determinePickResult(team, weekData.games);
      const points = result === "WIN" ? week.pointValue : 0;

      await prisma.pick.create({
        data: {
          userId,
          weekId: week.id,
          team,
          result,
          points,
        },
      });
    }
  }

  console.log("Created picks for all players (weeks 1-3)");
  console.log("\n--- Demo Data Summary ---");
  console.log("Admin: admin / admin123");
  console.log("Players: all use password 'password'");
  console.log(`Usernames: ${PLAYER_NAMES.map((p) => p.username).join(", ")}`);
  console.log(`Teams: ${teamNames.join(", ")}`);
  console.log("Season: 2025, Weeks 1-3 complete, Week 4 upcoming");
  console.log(`Remaining invite codes: ${invites.length - PLAYER_NAMES.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
