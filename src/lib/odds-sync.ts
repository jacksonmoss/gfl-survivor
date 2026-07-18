// Server-side bulk-odds fetch + persistence. Kept out of src/lib/odds.ts (which
// is pure/unit-tested) because this touches the network and Prisma. Shared by
// the score-sync route and the admin import-schedule route so the spread lands
// on Game.spreadHome; the picks page then reads it straight from the DB.

import { prisma } from "@/lib/prisma";
import { getTeamName } from "@/lib/nfl-teams";
import { buildOddsApiUrl, parseSpreadForGame, gameNeedsOdds, oddsRefreshDue } from "@/lib/odds";
import type { OddsEvent } from "@/lib/odds";

// Cap the external call so a slow upstream can't hang the caller.
const FETCH_TIMEOUT_MS = 10_000;

// Shared across routes: the last time we hit The Odds API. Module-level (resets
// on restart, single-instance only — same tradeoff as the score-sync cooldown),
// so the 6h refresh gate holds across both the sync and import-schedule routes.
let lastOddsFetch: number | null = null;

interface OddsGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  kickoff: Date;
}

/**
 * Refresh cached spreads for the given games. No-ops (returns 0) when ODDS_API_KEY
 * is unset, when no game is within the pricing window, or when the shared 6h
 * refresh gate hasn't elapsed. Failures are swallowed so odds never break the
 * caller (score sync / schedule import). Returns the number of games updated.
 */
export async function refreshOddsForGames(games: OddsGame[], now: Date = new Date()): Promise<number> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return 0;

  const candidates = games.filter((g) => gameNeedsOdds(g, now));
  if (candidates.length === 0) return 0;
  if (!oddsRefreshDue(lastOddsFetch, now)) return 0;

  // Claim the slot before awaiting so overlapping calls don't double-fetch.
  lastOddsFetch = now.getTime();

  let events: OddsEvent[];
  try {
    const res = await fetch(buildOddsApiUrl(apiKey), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return 0;
    events = await res.json();
  } catch {
    return 0;
  }

  const results = await Promise.allSettled(
    candidates.map(async (game) => {
      const spreadHome = parseSpreadForGame(events, getTeamName(game.homeTeam), getTeamName(game.awayTeam));
      if (spreadHome === null) return false;
      await prisma.game.update({ where: { id: game.id }, data: { spreadHome } });
      return true;
    }),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}
