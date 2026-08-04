import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeSeasonStats, type StatsPick, type StatsWeek } from "@/lib/stats";

/**
 * GET /api/stats?seasonId= — season-to-date stats plus a per-week digest, for
 * any authenticated user. Mirrors the leaderboard's season selector.
 *
 * **Pick visibility.** This surface is all-users, so pick-derived stats (most
 * picked team, consensus bust, upset winners/losers) would leak other people's
 * picks if computed naively. Two independent guards, both applied:
 *
 *  1. Only picks whose game has already kicked off are passed to the engine —
 *     the same rule the leaderboard uses, minus its own-picks exception, so
 *     every user sees identical aggregates.
 *  2. `computeSeasonStats` only publishes stats for *completed* weeks (every
 *     game FINAL ⇒ every game kicked off).
 *
 * (2) alone is sufficient; (1) is kept so a future change to what counts as
 * "complete" can't quietly turn into a leak. There is deliberately no admin
 * branch here — the admin view that sees everything is #145.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const seasons = await prisma.season.findMany({
    select: { id: true, year: true, isActive: true },
    orderBy: { year: "desc" },
  });

  const seasonId = req.nextUrl.searchParams.get("seasonId");
  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId } })
    : await prisma.season.findFirst({ where: { isActive: true } });

  if (!season) {
    return NextResponse.json({ seasons, season: null, stats: null, digests: [] });
  }

  const weeks = await prisma.week.findMany({
    where: { seasonId: season.id },
    orderBy: { weekNumber: "asc" },
    include: { games: true },
  });

  const players = await prisma.user.findMany({
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });

  const picks = await prisma.pick.findMany({
    where: { week: { seasonId: season.id } },
    select: { userId: true, team: true, result: true, points: true, week: { select: { weekNumber: true } } },
  });

  const statsWeeks: StatsWeek[] = weeks.map((w) => ({
    weekNumber: w.weekNumber,
    label: w.label,
    isPlayoff: w.isPlayoff,
    pointValue: w.pointValue,
    games: w.games.map((g) => ({
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      status: g.status,
      spreadHome: g.spreadHome,
    })),
  }));

  // Guard (1): drop any pick whose game hasn't kicked off yet. A pick with no
  // matching game (team on bye, schedule edited after the pick) can't be shown
  // to have started, so it's dropped too.
  const now = new Date();
  const kickoffByWeekTeam = new Map<string, Date>();
  for (const w of weeks) {
    for (const g of w.games) {
      kickoffByWeekTeam.set(`${w.weekNumber}:${g.homeTeam}`, g.kickoff);
      kickoffByWeekTeam.set(`${w.weekNumber}:${g.awayTeam}`, g.kickoff);
    }
  }

  const statsPicks: StatsPick[] = picks
    .map((p) => ({
      userId: p.userId,
      weekNumber: p.week.weekNumber,
      team: p.team,
      result: p.result,
      points: p.points,
    }))
    .filter((p) => {
      const kickoff = kickoffByWeekTeam.get(`${p.weekNumber}:${p.team}`);
      return kickoff !== undefined && now >= kickoff;
    });

  const { stats, digests } = computeSeasonStats(statsWeeks, players, statsPicks);

  return NextResponse.json({
    seasons,
    season: { id: season.id, year: season.year, isActive: season.isActive },
    stats,
    digests,
  });
}
