import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = session.user.role === "ADMIN";

  // All seasons, for the leaderboard's season selector (history)
  const seasons = await prisma.season.findMany({
    select: { id: true, year: true, isActive: true },
    orderBy: { year: "desc" },
  });

  // Selected season: explicit ?seasonId= wins, otherwise the active season
  const seasonId = req.nextUrl.searchParams.get("seasonId");
  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId } })
    : await prisma.season.findFirst({ where: { isActive: true } });

  if (!season) {
    return NextResponse.json({ players: [], teams: [], seasons, season: null });
  }

  // Get all users with their picks for this season, including game data for visibility check
  const users = await prisma.user.findMany({
    include: {
      picks: {
        where: { week: { seasonId: season.id } },
        include: { week: { include: { games: true } } },
      },
      team: true,
    },
  });

  const now = new Date();

  const players = users.map((u) => {
    // Filter picks based on visibility: non-admins can only see picks
    // whose game has kicked off (or their own picks)
    const visiblePicks = u.picks.filter((p) => {
      if (isAdmin || u.id === session.user.id) return true;
      const game = p.week.games.find(
        (g) => g.homeTeam === p.team || g.awayTeam === p.team
      );
      return game ? now >= game.kickoff : false;
    });

    const totalPicks = visiblePicks.length;
    const wins = visiblePicks.filter((p) => p.result === "WIN").length;
    const losses = visiblePicks.filter((p) => p.result === "LOSS").length;
    const points = visiblePicks.reduce((sum, p) => sum + p.points, 0);
    const winPct = totalPicks > 0 ? wins / (wins + losses || 1) : 0;

    return {
      id: u.id,
      displayName: u.displayName,
      username: u.username,
      teamName: u.team?.name ?? null,
      points,
      wins,
      losses,
      totalPicks,
      winPct,
      picks: visiblePicks.map((p) => ({
        week: p.week.weekNumber,
        label: p.week.label,
        team: p.team,
        result: p.result,
        points: p.points,
      })),
    };
  });

  players.sort((a, b) => b.points - a.points);

  // Team trophy standings
  const teamMap = new Map<string, { name: string; players: typeof players }>();
  for (const p of players) {
    if (p.teamName) {
      if (!teamMap.has(p.teamName)) {
        teamMap.set(p.teamName, { name: p.teamName, players: [] });
      }
      teamMap.get(p.teamName)!.players.push(p);
    }
  }

  const teams = Array.from(teamMap.values())
    .map((t) => {
      const totalWinPct =
        t.players.reduce((sum, p) => sum + p.winPct, 0) / t.players.length;
      return {
        name: t.name,
        playerCount: t.players.length,
        avgWinPct: totalWinPct,
        totalPoints: t.players.reduce((sum, p) => sum + p.points, 0),
        players: t.players.map((p) => ({
          displayName: p.displayName,
          points: p.points,
          winPct: p.winPct,
        })),
      };
    })
    .sort((a, b) => b.avgWinPct - a.avgWinPct);

  return NextResponse.json({
    players,
    teams,
    seasons,
    season: { id: season.id, year: season.year, isActive: season.isActive },
  });
}
