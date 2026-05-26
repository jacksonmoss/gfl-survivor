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

export function getESPNWeekParams(weekNumber: number, isPlayoff: boolean): { seasonType: number; espnWeek: number } {
  const seasonType = isPlayoff ? 3 : 2;
  const espnWeek = isPlayoff
    ? weekNumber === 22 ? 5 : weekNumber - 18
    : weekNumber;
  return { seasonType, espnWeek };
}
