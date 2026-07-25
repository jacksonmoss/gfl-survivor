import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getESPNWeekParams, buildESPNUrl } from "@/lib/espn";
import type { ESPNResponse } from "@/lib/espn";
import { extractImportableGames } from "@/lib/score-sync";
import { refreshOddsForGames } from "@/lib/odds-sync";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { seasonId, weekNumber } = await req.json();

  if (!seasonId || !weekNumber) {
    return NextResponse.json(
      { error: "seasonId and weekNumber are required" },
      { status: 400 }
    );
  }

  const week = await prisma.week.findUnique({
    where: { seasonId_weekNumber: { seasonId, weekNumber } },
    include: { season: true },
  });

  if (!week) {
    return NextResponse.json({ error: "Week not found" }, { status: 404 });
  }

  const { seasonType, espnWeek } = getESPNWeekParams(weekNumber, week.isPlayoff);
  const url = buildESPNUrl(week.season.year, seasonType, espnWeek);

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json(
      { error: `ESPN API returned ${res.status}` },
      { status: 502 }
    );
  }

  const data: ESPNResponse = await res.json();

  if (!data.events || data.events.length === 0) {
    return NextResponse.json(
      { error: "No games found for this week" },
      { status: 404 }
    );
  }

  const existingGames = await prisma.game.findMany({
    where: { weekId: week.id },
    select: { externalId: true },
  });
  const existingExternalIds = new Set(existingGames.map((g) => g.externalId).filter((id): id is string => id !== null));

  const gamesToImport = extractImportableGames(data, existingExternalIds);
  let imported = 0;
  const skipped = data.events.length - gamesToImport.length;

  for (const game of gamesToImport) {
    await prisma.game.create({
      data: { weekId: week.id, ...game },
    });
    imported++;
  }

  // Update week's pickDeadline to earliest kickoff
  if (imported > 0) {
    const earliestGame = await prisma.game.findFirst({
      where: { weekId: week.id },
      orderBy: { kickoff: "asc" },
    });
    if (earliestGame) {
      await prisma.week.update({
        where: { id: week.id },
        data: { pickDeadline: earliestGame.kickoff },
      });
    }
  }

  // Prime betting spreads for the imported games (no-op without ODDS_API_KEY,
  // or if the shared 6h gate hasn't elapsed since the last odds fetch).
  const weekGames = await prisma.game.findMany({
    where: { weekId: week.id },
    select: { id: true, homeTeam: true, awayTeam: true, status: true, kickoff: true },
  });
  const spreads = await refreshOddsForGames(weekGames);

  return NextResponse.json({ imported, skipped, total: data.events.length, spreads });
}
