import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getESPNWeekParams, buildESPNUrl } from "@/lib/espn";
import type { ESPNResponse } from "@/lib/espn";
import { computeAllGameUpdates } from "@/lib/score-sync";
import { Prisma } from "@/generated/prisma/client";
import { getStadium } from "@/lib/stadiums";
import { buildOpenMeteoUrl, parseWeatherResponse, shouldFetchWeather } from "@/lib/weather";
import type { GameWeather } from "@/lib/weather";
import { refreshOddsForGames } from "@/lib/odds-sync";

let lastSyncTime = 0;
const SYNC_COOLDOWN_MS = 30_000;
// Cap every external call so a slow upstream can't hang the sync handler
// (which the picks page polls every 30s during live games).
const FETCH_TIMEOUT_MS = 10_000;

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

  const firstPlayoffWeek =
    activeSeason.weeks.find((w) => w.isPlayoff)?.weekNumber ?? currentWeek.weekNumber;
  const { seasonType, espnWeek } = getESPNWeekParams(
    currentWeek.weekNumber,
    currentWeek.isPlayoff,
    firstPlayoffWeek
  );
  const url = buildESPNUrl(activeSeason.year, seasonType, espnWeek);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    return NextResponse.json({ error: "ESPN API unreachable" }, { status: 502 });
  }
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
    } else if (update.justFinished && update.isTie) {
      // Level game: grade both teams' picks as a PUSH (0 points, not a win).
      // winnerTeam/losingTeam are null on a tie, so pull the two teams off the game.
      const game = currentWeek.games.find((g) => g.id === update.gameId);
      if (game) {
        const tiePicks = await prisma.pick.updateMany({
          where: {
            weekId: currentWeek.id,
            team: { in: [game.homeTeam, game.awayTeam] },
            result: "PENDING",
          },
          data: { result: "PUSH", points: 0 },
        });
        graded += tiePicks.count;
      }
    }
  }

  // Refresh weather for outdoor games in the lookahead window. Cached in
  // Game.weatherJson and gated by shouldFetchWeather, so we don't re-hit
  // Open-Meteo on every 30s poll. Failures are swallowed per-game so a weather
  // outage never breaks score syncing or blanks the cards.
  const statusById = new Map(updates.map((u) => [u.gameId, u.status]));
  const nowDate = new Date();
  const toFetch = currentWeek.games.filter((game) => {
    const stadium = getStadium(game.homeTeam);
    if (!stadium) return false;
    const existing = game.weatherJson as GameWeather | null;
    return shouldFetchWeather(
      { indoor: stadium.indoor, status: statusById.get(game.id) ?? game.status, kickoff: game.kickoff },
      existing?.fetched_at ?? null,
      nowDate,
    );
  });

  const weatherResults = await Promise.allSettled(
    toFetch.map(async (game) => {
      const stadium = getStadium(game.homeTeam)!;
      const wres = await fetch(buildOpenMeteoUrl(stadium.lat, stadium.lon, game.kickoff), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!wres.ok) return;
      const weather = parseWeatherResponse(await wres.json(), game.kickoff, nowDate);
      if (!weather) return;
      await prisma.game.update({
        where: { id: game.id },
        data: { weatherJson: weather as unknown as Prisma.InputJsonValue },
      });
      return true;
    }),
  );
  const weatherUpdated = weatherResults.filter((r) => r.status === "fulfilled" && r.value).length;

  // Refresh betting spreads (bulk single call, gated to every ~6h). Reads the
  // freshly-synced status so a game that just started/finished is excluded.
  const spreadsUpdated = await refreshOddsForGames(
    currentWeek.games.map((g) => ({
      id: g.id,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      status: statusById.get(g.id) ?? g.status,
      kickoff: g.kickoff,
    })),
    nowDate,
  );

  return NextResponse.json({ synced, graded, weather: weatherUpdated, spreads: spreadsUpdated, week: currentWeek.weekNumber });
}
