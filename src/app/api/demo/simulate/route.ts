import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isDemoMode,
  teamsPlaying,
  assignRandomPicks,
  simulateScore,
  gradeDemoPick,
  shiftKickoffs,
} from "@/lib/demo";
import { resolveDemoWeek } from "@/lib/demo-week";

// How far in the past the simulated slate lands. The last game finishing an
// hour ago (rather than a second ago) reads as "the week is over" everywhere:
// past kickoffs unlock pick visibility on the leaderboard, and the picks page
// stops offering to change a locked pick.
const LAST_KICKOFF_AGO_MS = 60 * 60 * 1000;

/**
 * Play one week out end to end (#161) — the whole point of demo mode.
 *
 * Fills in random picks for everyone who hasn't picked, gives the games final
 * scores, and grades every pick in the week. The customer makes their own pick
 * first, presses this, and watches the pick → lock → grade → leaderboard loop
 * complete in a few seconds instead of over a weekend.
 *
 * Any signed-in user may run it: the entire install is a demo when this is on,
 * and the customer may well be exploring as a player rather than as the admin.
 * The gate that matters is DEMO_MODE, which is never set in production.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // 404 rather than 403: with demo mode off, this endpoint doesn't exist.
  if (!isDemoMode()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resolved = await resolveDemoWeek(body?.weekId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const week = resolved.week;

  if (week.games.length === 0) {
    return NextResponse.json(
      { error: `${week.label} has no games to simulate.` },
      { status: 400 },
    );
  }

  const playing = teamsPlaying(week.games);
  const rng = Math.random;

  // Everyone's picks for the season, so the random assignment can respect the
  // no-reuse rule — the simulated league has to end up in a state the app
  // itself would have allowed.
  const users = await prisma.user.findMany({
    select: {
      id: true,
      picks: {
        where: { week: { seasonId: week.seasonId } },
        select: { weekId: true, team: true },
      },
    },
  });

  const assignments = assignRandomPicks(
    users
      .filter((u) => !u.picks.some((p) => p.weekId === week.id))
      .map((u) => ({ userId: u.id, usedTeams: u.picks.map((p) => p.team) })),
    playing,
    rng,
  );

  // Pull the slate into the past, preserving its shape (see shiftKickoffs).
  const shifted = shiftKickoffs(
    week.games.map((g) => g.kickoff),
    "last",
    new Date(Date.now() - LAST_KICKOFF_AGO_MS),
  );

  // Games already final keep their real scores — re-running the button must
  // not rewrite a result the customer has already been shown.
  const scored = week.games.map((game, i) => ({
    id: game.id,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    kickoff: shifted[i],
    ...(game.status === "FINAL" && game.homeScore !== null && game.awayScore !== null
      ? { homeScore: game.homeScore, awayScore: game.awayScore }
      : simulateScore(rng)),
  }));

  const existingPicks = await prisma.pick.count({ where: { weekId: week.id } });

  const gameByTeam = new Map<string, (typeof scored)[number]>();
  for (const g of scored) {
    gameByTeam.set(g.homeTeam, g);
    gameByTeam.set(g.awayTeam, g);
  }

  // One transaction: a half-simulated week (games final, picks ungraded) is a
  // confusing thing to hand a customer, and there's no way to retry out of it.
  let graded = 0;
  await prisma.$transaction(
    async (tx) => {
      if (assignments.length > 0) {
        await tx.pick.createMany({
          data: assignments.map((a) => ({ userId: a.userId, weekId: week.id, team: a.team })),
          // Two people pressing the button at once would otherwise collide on
          // Pick's (userId, weekId) unique — a 500 in front of a customer.
          skipDuplicates: true,
        });
      }

      for (const game of scored) {
        await tx.game.update({
          where: { id: game.id },
          data: {
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            status: "FINAL",
            kickoff: game.kickoff,
          },
        });
      }

      // Grade every pick in the week, including ones created a moment ago.
      // Fetched fresh so the new rows are included and each carries its id.
      const toGrade = await tx.pick.findMany({
        where: { weekId: week.id },
        select: { id: true, team: true },
      });
      for (const pick of toGrade) {
        const game = gameByTeam.get(pick.team);
        if (!game) continue;
        const result = gradeDemoPick(pick.team, game, week.pointValue);
        if (!result) continue;
        await tx.pick.update({
          where: { id: pick.id },
          data: { result: result.result, points: result.points },
        });
        graded++;
      }

      // Keep the week's deadline consistent with the slate it now has.
      await tx.week.update({
        where: { id: week.id },
        data: { pickDeadline: shifted.reduce((a, b) => (a < b ? a : b)) },
      });
    },
    { timeout: 20_000 },
  );

  return NextResponse.json({
    week: { id: week.id, weekNumber: week.weekNumber, label: week.label },
    picksCreated: assignments.length,
    gamesSimulated: scored.length,
    graded,
    totalPicks: existingPicks + assignments.length,
  });
}
