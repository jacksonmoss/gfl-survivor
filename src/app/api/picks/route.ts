import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const activeSeason = await prisma.season.findFirst({
    where: { isActive: true },
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        include: {
          games: { orderBy: { kickoff: "asc" } },
        },
      },
    },
  });

  if (!activeSeason) {
    return NextResponse.json({ season: null, picks: [], usedTeams: [] });
  }

  const picks = await prisma.pick.findMany({
    where: {
      userId: session.user.id,
      week: { seasonId: activeSeason.id },
    },
    include: { week: true },
  });

  const usedTeams = picks.map((p) => p.team);

  return NextResponse.json({
    season: activeSeason,
    picks,
    usedTeams,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { weekId, team } = await req.json();

  if (!weekId || !team) {
    return NextResponse.json({ error: "Week and team are required" }, { status: 400 });
  }

  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: { season: true, games: true },
  });

  if (!week || !week.season.isActive) {
    return NextResponse.json({ error: "Invalid week" }, { status: 400 });
  }

  const now = new Date();

  // Check if the selected team's game has already kicked off
  const teamGame = week.games.find(
    (g) => g.homeTeam === team || g.awayTeam === team
  );

  if (!teamGame) {
    return NextResponse.json(
      { error: "This team is not playing this week" },
      { status: 400 }
    );
  }

  if (now >= teamGame.kickoff) {
    return NextResponse.json(
      { error: "This team's game has already started" },
      { status: 400 }
    );
  }

  // If user already has a pick for this week, check if their current pick's game
  // has started — if so, they can't change it
  const existingWeekPick = await prisma.pick.findUnique({
    where: {
      userId_weekId: {
        userId: session.user.id,
        weekId,
      },
    },
  });

  if (existingWeekPick) {
    const currentPickGame = week.games.find(
      (g) => g.homeTeam === existingWeekPick.team || g.awayTeam === existingWeekPick.team
    );
    if (currentPickGame && now >= currentPickGame.kickoff) {
      return NextResponse.json(
        { error: "Your current pick's game has already started, cannot change" },
        { status: 400 }
      );
    }
  }

  // Check team not already used this season (in a different week)
  const usedInOtherWeek = await prisma.pick.findFirst({
    where: {
      userId: session.user.id,
      team,
      week: { seasonId: week.seasonId },
      NOT: { weekId },
    },
  });

  if (usedInOtherWeek) {
    return NextResponse.json(
      { error: "You already used this team this season" },
      { status: 400 }
    );
  }

  // Upsert the pick (allows changing pick before kickoff)
  const pick = await prisma.pick.upsert({
    where: {
      userId_weekId: {
        userId: session.user.id,
        weekId,
      },
    },
    update: { team },
    create: {
      userId: session.user.id,
      weekId,
      team,
    },
  });

  return NextResponse.json(pick);
}
