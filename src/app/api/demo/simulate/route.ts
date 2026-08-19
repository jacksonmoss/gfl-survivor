import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  isDemoMode,
  teamsPlaying,
  planMultiWeekPicks,
  simulateScore,
  gradeDemoPick,
  shiftKickoffs,
  playedWeekAnchor,
} from "@/lib/demo";
import { resolveDemoWeek, collectDemoWeeks } from "@/lib/demo-week";

// Ceiling on a single run. Four weeks is what the demo seed ships and is
// already enough for streaks, lead changes and a visibly shrinking pick pool;
// the cap is here so a hand-rolled request can't ask for a 22-week run and sit
// there rewriting the whole season.
const MAX_WEEKS = 8;

/**
 * Play one or more weeks out end to end (#161, extended to multi-week in #163)
 * — the whole point of demo mode.
 *
 * Fills in random picks for everyone who hasn't picked, gives the games final
 * scores, and grades every pick. The customer makes their own pick first,
 * presses this, and watches the pick → lock → grade → leaderboard loop
 * complete in a few seconds instead of over a weekend. Running several weeks
 * at once is what makes the *season* legible: standings move, streaks build,
 * and each player's pool of unused teams visibly shrinks.
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

  const requested = Number(body?.weeks ?? 1);
  const count = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_WEEKS) : 1;

  // Consecutive weeks with a slate, starting at the selected one. A week the
  // schedule hasn't reached yet ends the run rather than being skipped over —
  // simulating week 6 while week 5 sits empty would leave a hole in the season.
  const weeks = await collectDemoWeeks(resolved.week, count);
  if (weeks.length === 0) {
    return NextResponse.json(
      { error: `${resolved.week.label} has no games to simulate.` },
      { status: 400 },
    );
  }

  const rng = Math.random;
  const now = new Date();

  // Everyone's picks for the season, so the random assignment can respect the
  // no-reuse rule — the simulated league has to end up in a state the app
  // itself would have allowed. Picks inside the run are excluded from the
  // starting usage; planMultiWeekPicks re-accumulates them week by week.
  const weekIds = new Set(weeks.map((w) => w.id));
  const users = await prisma.user.findMany({
    select: {
      id: true,
      picks: {
        where: { week: { seasonId: resolved.week.seasonId } },
        select: { weekId: true, team: true },
      },
    },
  });

  const plans = planMultiWeekPicks(
    users.map((u) => ({
      userId: u.id,
      usedTeams: u.picks.filter((p) => !weekIds.has(p.weekId)).map((p) => p.team),
    })),
    weeks.map((week) => ({
      weekId: week.id,
      playing: teamsPlaying(week.games),
      alreadyPicked: users
        .filter((u) => u.picks.some((p) => p.weekId === week.id))
        .map((u) => u.id),
    })),
    rng,
  );
  const assignmentsByWeek = new Map(plans.map((p) => [p.weekId, p.assignments]));

  const played: { weekNumber: number; label: string; picksCreated: number; graded: number }[] = [];

  for (const [index, week] of weeks.entries()) {
    const assignments = assignmentsByWeek.get(week.id) ?? [];

    // Pull the slate into the past, preserving its shape (see shiftKickoffs).
    // Earlier weeks of the run land a week further back each, so the finished
    // stretch reads as a season rather than one very long afternoon.
    const shifted = shiftKickoffs(
      week.games.map((g) => g.kickoff),
      "last",
      playedWeekAnchor(index, weeks.length, now),
    );

    // Games already final keep their real scores — re-running the button must
    // not rewrite a result the customer has already been shown.
    const scored = week.games.map((game, i) => ({
      id: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      kickoff: shifted[i],
      // The betting line steers the winner, so upsets stay the exception —
      // coin-flip results made "upsets" half the slate and the stats page's
      // upset section meaningless.
      ...(game.status === "FINAL" && game.homeScore !== null && game.awayScore !== null
        ? { homeScore: game.homeScore, awayScore: game.awayScore }
        : simulateScore(rng, game.spreadHome)),
    }));

    const gameByTeam = new Map<string, (typeof scored)[number]>();
    for (const g of scored) {
      gameByTeam.set(g.homeTeam, g);
      gameByTeam.set(g.awayTeam, g);
    }

    // One transaction per week: a half-simulated week (games final, picks
    // ungraded) is a confusing thing to hand a customer. Deliberately *not*
    // one transaction for the whole run — four weeks of row-by-row updates is
    // a long time to hold one open, and a run that fails part way through is
    // recoverable with Reset.
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

    played.push({
      weekNumber: week.weekNumber,
      label: week.label,
      picksCreated: assignments.length,
      graded,
    });
  }

  return NextResponse.json({
    // First week of the run, for callers that only care where it started.
    week: { id: weeks[0].id, weekNumber: weeks[0].weekNumber, label: weeks[0].label },
    weeksPlayed: played,
    weeksRequested: count,
    picksCreated: played.reduce((sum, w) => sum + w.picksCreated, 0),
    gamesSimulated: weeks.reduce((sum, w) => sum + w.games.length, 0),
    graded: played.reduce((sum, w) => sum + w.graded, 0),
  });
}
