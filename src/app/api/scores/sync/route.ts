import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mapTeamAbbr, getESPNWeekParams, buildESPNUrl } from "@/lib/espn";
import type { ESPNResponse } from "@/lib/espn";

let lastSyncTime = 0;
const SYNC_COOLDOWN_MS = 30_000;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Global rate limit: one sync per 30 seconds
  const now = Date.now();
  if (now - lastSyncTime < SYNC_COOLDOWN_MS) {
    return NextResponse.json({ error: "Rate limited", retryAfter: Math.ceil((SYNC_COOLDOWN_MS - (now - lastSyncTime)) / 1000) }, { status: 429 });
  }
  lastSyncTime = now;

  const activeSeason = await prisma.season.findFirst({
    where: { isActive: true },
    include: {
      weeks: {
        orderBy: { weekNumber: "asc" },
        include: { games: true },
      },
    },
  });

  if (!activeSeason) {
    return NextResponse.json({ error: "No active season" }, { status: 404 });
  }

  // Find the current week: first week with games not all FINAL
  const currentWeek = activeSeason.weeks.find(
    (w) => w.games.length > 0 && w.games.some((g) => g.status !== "FINAL")
  );

  if (!currentWeek) {
    return NextResponse.json({ synced: 0, graded: 0, message: "No active games" });
  }

  const { seasonType, espnWeek } = getESPNWeekParams(currentWeek.weekNumber, currentWeek.isPlayoff);
  const url = buildESPNUrl(activeSeason.year, seasonType, espnWeek);

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: `ESPN API returned ${res.status}` }, { status: 502 });
  }

  const data: ESPNResponse = await res.json();

  let synced = 0;
  let graded = 0;

  for (const event of data.events) {
    const competition = event.competitions[0];
    if (!competition) continue;

    const espnStatus = competition.status.type.state;
    const dbGame = currentWeek.games.find((g) => g.externalId === event.id);
    if (!dbGame) continue;

    const homeComp = competition.competitors.find((c) => c.homeAway === "home");
    const awayComp = competition.competitors.find((c) => c.homeAway === "away");
    if (!homeComp || !awayComp) continue;

    const homeScore = parseInt(homeComp.score) || 0;
    const awayScore = parseInt(awayComp.score) || 0;

    let newStatus: "SCHEDULED" | "LIVE" | "FINAL";
    if (espnStatus === "post") newStatus = "FINAL";
    else if (espnStatus === "in") newStatus = "LIVE";
    else newStatus = "SCHEDULED";

    // Only update if something changed
    if (dbGame.homeScore !== homeScore || dbGame.awayScore !== awayScore || dbGame.status !== newStatus) {
      await prisma.game.update({
        where: { id: dbGame.id },
        data: { homeScore, awayScore, status: newStatus },
      });
      synced++;

      // Auto-grade picks when a game goes FINAL
      if (newStatus === "FINAL" && dbGame.status !== "FINAL") {
        const homeTeam = mapTeamAbbr(homeComp.team.abbreviation);
        const awayTeam = mapTeamAbbr(awayComp.team.abbreviation);
        const winner = homeScore > awayScore ? homeTeam : awayTeam;

        // Grade all PENDING picks for teams in this game
        const picksToGrade = await prisma.pick.findMany({
          where: {
            weekId: currentWeek.id,
            team: { in: [homeTeam, awayTeam] },
            result: "PENDING",
          },
        });

        for (const pick of picksToGrade) {
          const isWin = pick.team === winner;
          await prisma.pick.update({
            where: { id: pick.id },
            data: {
              result: isWin ? "WIN" : "LOSS",
              points: isWin ? currentWeek.pointValue : 0,
            },
          });
          graded++;
        }
      }
    }
  }

  return NextResponse.json({ synced, graded, week: currentWeek.weekNumber });
}
