import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mapTeamAbbr, getESPNWeekParams, buildESPNUrl } from "@/lib/espn";
import type { ESPNResponse } from "@/lib/espn";

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

  let imported = 0;
  let skipped = 0;

  for (const event of data.events) {
    const competition = event.competitions[0];
    if (!competition) continue;

    const homeComp = competition.competitors.find((c) => c.homeAway === "home");
    const awayComp = competition.competitors.find((c) => c.homeAway === "away");
    if (!homeComp || !awayComp) continue;

    const homeTeam = mapTeamAbbr(homeComp.team.abbreviation);
    const awayTeam = mapTeamAbbr(awayComp.team.abbreviation);
    const kickoff = new Date(competition.date);
    const externalId = event.id;

    // Skip if already imported
    const existing = await prisma.game.findUnique({
      where: { externalId },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.game.create({
      data: {
        weekId: week.id,
        homeTeam,
        awayTeam,
        kickoff,
        externalId,
      },
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

  return NextResponse.json({ imported, skipped, total: data.events.length });
}
