export const NFL_TEAMS = [
  { abbr: "ARI", name: "Arizona Cardinals", conference: "NFC", division: "West" },
  { abbr: "ATL", name: "Atlanta Falcons", conference: "NFC", division: "South" },
  { abbr: "BAL", name: "Baltimore Ravens", conference: "AFC", division: "North" },
  { abbr: "BUF", name: "Buffalo Bills", conference: "AFC", division: "East" },
  { abbr: "CAR", name: "Carolina Panthers", conference: "NFC", division: "South" },
  { abbr: "CHI", name: "Chicago Bears", conference: "NFC", division: "North" },
  { abbr: "CIN", name: "Cincinnati Bengals", conference: "AFC", division: "North" },
  { abbr: "CLE", name: "Cleveland Browns", conference: "AFC", division: "North" },
  { abbr: "DAL", name: "Dallas Cowboys", conference: "NFC", division: "East" },
  { abbr: "DEN", name: "Denver Broncos", conference: "AFC", division: "West" },
  { abbr: "DET", name: "Detroit Lions", conference: "NFC", division: "North" },
  { abbr: "GB", name: "Green Bay Packers", conference: "NFC", division: "North" },
  { abbr: "HOU", name: "Houston Texans", conference: "AFC", division: "South" },
  { abbr: "IND", name: "Indianapolis Colts", conference: "AFC", division: "South" },
  { abbr: "JAX", name: "Jacksonville Jaguars", conference: "AFC", division: "South" },
  { abbr: "KC", name: "Kansas City Chiefs", conference: "AFC", division: "West" },
  { abbr: "LV", name: "Las Vegas Raiders", conference: "AFC", division: "West" },
  { abbr: "LAC", name: "Los Angeles Chargers", conference: "AFC", division: "West" },
  { abbr: "LAR", name: "Los Angeles Rams", conference: "NFC", division: "West" },
  { abbr: "MIA", name: "Miami Dolphins", conference: "AFC", division: "East" },
  { abbr: "MIN", name: "Minnesota Vikings", conference: "NFC", division: "North" },
  { abbr: "NE", name: "New England Patriots", conference: "AFC", division: "East" },
  { abbr: "NO", name: "New Orleans Saints", conference: "NFC", division: "South" },
  { abbr: "NYG", name: "New York Giants", conference: "NFC", division: "East" },
  { abbr: "NYJ", name: "New York Jets", conference: "AFC", division: "East" },
  { abbr: "PHI", name: "Philadelphia Eagles", conference: "NFC", division: "East" },
  { abbr: "PIT", name: "Pittsburgh Steelers", conference: "AFC", division: "North" },
  { abbr: "SF", name: "San Francisco 49ers", conference: "NFC", division: "West" },
  { abbr: "SEA", name: "Seattle Seahawks", conference: "NFC", division: "West" },
  { abbr: "TB", name: "Tampa Bay Buccaneers", conference: "NFC", division: "South" },
  { abbr: "TEN", name: "Tennessee Titans", conference: "AFC", division: "South" },
  { abbr: "WAS", name: "Washington Commanders", conference: "NFC", division: "East" },
] as const;

export type NFLTeamAbbr = (typeof NFL_TEAMS)[number]["abbr"];

export function getTeamName(abbr: string): string {
  return NFL_TEAMS.find((t) => t.abbr === abbr)?.name ?? abbr;
}

// Our abbr → ESPN CDN abbreviation (lowercase). Only WAS differs (ESPN uses WSH).
const ESPN_LOGO_ABBR: Partial<Record<string, string>> = { WAS: "wsh" };

export function getLogoUrl(abbr: string): string {
  const espnAbbr = ESPN_LOGO_ABBR[abbr] ?? abbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${espnAbbr}.png`;
}
