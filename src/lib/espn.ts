const ESPN_ABBR_MAP: Record<string, string> = {
  WSH: "WAS",
};

export function mapTeamAbbr(espnAbbr: string): string {
  return ESPN_ABBR_MAP[espnAbbr] ?? espnAbbr;
}

export interface ESPNCompetitor {
  homeAway: "home" | "away";
  team: { abbreviation: string };
  score: string;
  winner?: boolean;
}

export interface ESPNStatus {
  type: {
    id: string;
    name: string;
    state: "pre" | "in" | "post";
    completed: boolean;
  };
}

export interface ESPNCompetition {
  id: string;
  date: string;
  competitors: ESPNCompetitor[];
  status: ESPNStatus;
}

export interface ESPNEvent {
  id: string;
  competitions: ESPNCompetition[];
}

export interface ESPNResponse {
  events: ESPNEvent[];
}

export function buildESPNUrl(year: number, seasonType: number, week: number): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasonType}&week=${week}&dates=${year}`;
}

/**
 * Map one of our Week rows to the ESPN scoreboard query params.
 *
 * Regular-season weeks map 1:1 to ESPN weeks. Playoff weeks map by their
 * *round index within the playoffs* — the 1st playoff week is Wild Card, the
 * 2nd Divisional, etc. — NOT by a fixed offset from week 18, so the regular
 * season can grow or shrink without breaking playoff fetches. ESPN skips
 * playoff week 4 (Pro Bowl), so the 4th round (Super Bowl) maps to ESPN week 5.
 *
 * @param firstPlayoffWeek the `weekNumber` of the first playoff week in the
 *   season (19 for a standard 18-game regular season). Only consulted for
 *   playoff weeks.
 */
export function getESPNWeekParams(
  weekNumber: number,
  isPlayoff: boolean,
  firstPlayoffWeek: number
): { seasonType: number; espnWeek: number } {
  if (!isPlayoff) {
    return { seasonType: 2, espnWeek: weekNumber };
  }
  const round = weekNumber - firstPlayoffWeek + 1; // 1-based: WC=1, Div=2, Conf=3, SB=4
  // ESPN skips playoff week 4 (Pro Bowl), so round 4 (Super Bowl) is ESPN week 5.
  const espnWeek = round >= 4 ? round + 1 : round;
  return { seasonType: 3, espnWeek };
}
