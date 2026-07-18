// Betting-spread helpers built on The Odds API (https://the-odds-api.com/) — a
// free-tier (500 req/month) odds API. Unlike weather (per-stadium), the NFL
// odds endpoint returns EVERY upcoming game in one call, so the sync route
// makes a single bulk fetch and matches each game by team name. All functions
// here are pure so they can be unit-tested without hitting the network; the
// server-side fetch + persistence lives in src/lib/odds-sync.ts.

const ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds";

/** Only fetch spreads for games kicking off within this window (game-time line is most useful). */
export const ODDS_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-fetch the bulk odds no more often than this (protects the 500/month quota). */
export const ODDS_REFRESH_MS = 6 * 60 * 60 * 1000;

/** Build the spreads endpoint URL. Uses US bookmakers + the `spreads` market. */
export function buildOddsApiUrl(apiKey: string): string {
  const params = new URLSearchParams({
    apiKey,
    regions: "us",
    markets: "spreads",
    oddsFormat: "american",
  });
  return `${ODDS_API_BASE}?${params.toString()}`;
}

// Minimal shape of the pieces of The Odds API response we consume.
interface OddsOutcome {
  name?: string;
  point?: number;
}
interface OddsMarket {
  key?: string;
  outcomes?: OddsOutcome[];
}
interface OddsBookmaker {
  key?: string;
  markets?: OddsMarket[];
}
export interface OddsEvent {
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsBookmaker[];
}

/** Median of a non-empty list of numbers. */
export function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Find the game in an Odds API response matching the given full team names and
 * return the consensus (median across bookmakers) home-team spread, or null if
 * the game isn't listed or no bookmaker priced the spreads market. Team-name
 * matching is order-insensitive; the home spread is always read from the
 * outcome named `homeTeam`, so a swapped home/away in the feed can't flip it.
 */
export function parseSpreadForGame(
  events: OddsEvent[] | null | undefined,
  homeTeam: string,
  awayTeam: string,
): number | null {
  if (!Array.isArray(events)) return null;

  const pair = new Set([homeTeam, awayTeam]);
  const event = events.find(
    (e) => e.home_team && e.away_team && pair.has(e.home_team) && pair.has(e.away_team),
  );
  if (!event?.bookmakers) return null;

  const points: number[] = [];
  for (const book of event.bookmakers) {
    const spreads = book.markets?.find((m) => m.key === "spreads");
    const outcome = spreads?.outcomes?.find((o) => o.name === homeTeam);
    if (outcome && typeof outcome.point === "number" && Number.isFinite(outcome.point)) {
      points.push(outcome.point);
    }
  }
  if (points.length === 0) return null;
  return median(points);
}

/** True when a game is close enough to kickoff (and not started/final) to price. */
export function gameNeedsOdds(
  game: { status: string; kickoff: Date },
  now: Date = new Date(),
): boolean {
  if (game.status === "FINAL") return false;
  const untilKickoff = game.kickoff.getTime() - now.getTime();
  if (untilKickoff <= 0) return false; // started — spread is moot
  return untilKickoff <= ODDS_LOOKAHEAD_MS;
}

/** Whether the shared bulk-odds fetch is due, given when it last ran. */
export function oddsRefreshDue(lastFetchedAtMs: number | null, now: Date = new Date()): boolean {
  if (!lastFetchedAtMs) return true;
  return now.getTime() - lastFetchedAtMs >= ODDS_REFRESH_MS;
}

/**
 * Format a team's spread for display, given the home-team spread and whether
 * this side is the home team. Favorite → "-6.5", underdog → "+6.5", even → "PK".
 */
export function formatSpread(spreadHome: number, isHome: boolean): string {
  const spread = isHome ? spreadHome : -spreadHome;
  if (spread === 0) return "PK";
  return spread > 0 ? `+${spread}` : `${spread}`;
}
