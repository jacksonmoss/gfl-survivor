import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getESPNWeekParams, buildESPNUrl } from "@/lib/espn";
import type { ESPNResponse } from "@/lib/espn";
import { computeAllGameUpdates } from "@/lib/score-sync";

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

  const updates = computeAllGameUpdates(
    data,
    currentWeek.games
      .filter((g) => g.externalId !== null)
      .map((g) => ({
        id: g.id,
        externalId: g.externalId as string,
        homeScore: g.homeScore ?? 0,
        awayScore: g.awayScore ?? 0,
        status: g.status as "SCHEDULED" | "LIVE" | "FINAL",
      }))
  );

  for (const update of updates) {
    await prisma.game.update({
      where: { id: update.gameId },
      data: { homeScore: update.homeScore, awayScore: update.awayScore, status: update.status },
    });
    synced++;

    if (update.justFinished && update.winnerTeam && update.losingTeam) {
      const picksToGrade = await prisma.pick.findMany({
        where: {
          weekId: currentWeek.id,
          team: { in: [update.winnerTeam, update.losingTeam] },
          result: "PENDING",
        },
      });

      for (const pick of picksToGrade) {
        const isWin = pick.team === update.winnerTeam;
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

  return NextResponse.json({ synced, graded, week: currentWeek.weekNumber });
}
