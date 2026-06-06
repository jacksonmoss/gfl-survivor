import { mapTeamAbbr } from "@/lib/espn";
import type { ESPNResponse, ESPNEvent } from "@/lib/espn";

export type GameStatus = "SCHEDULED" | "LIVE" | "FINAL";

export interface DbGame {
  id: string;
  externalId: string;
  homeScore: number;
  awayScore: number;
  status: GameStatus;
}

export interface GameUpdate {
  gameId: string;
  homeScore: number;
  awayScore: number;
  status: GameStatus;
  /** Set when a game just transitioned to FINAL for pick grading */
  justFinished: boolean;
  winnerTeam: string | null;
  losingTeam: string | null;
}

export interface ImportableGame {
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
}

/** Derive status from ESPN state string */
function espnStateToStatus(state: string): GameStatus {
  if (state === "post") return "FINAL";
  if (state === "in") return "LIVE";
  return "SCHEDULED";
}

/**
 * Compute what DB update (if any) is needed for a single ESPN event against
 * the current DB game state. Returns null if nothing changed.
 */
export function computeGameUpdate(event: ESPNEvent, dbGame: DbGame): GameUpdate | null {
  const competition = event.competitions[0];
  if (!competition) return null;

  const homeComp = competition.competitors.find((c) => c.homeAway === "home");
  const awayComp = competition.competitors.find((c) => c.homeAway === "away");
  if (!homeComp || !awayComp) return null;

  const homeScore = parseInt(homeComp.score) || 0;
  const awayScore = parseInt(awayComp.score) || 0;
  const newStatus = espnStateToStatus(competition.status.type.state);

  if (dbGame.homeScore === homeScore && dbGame.awayScore === awayScore && dbGame.status === newStatus) {
    return null;
  }

  const justFinished = newStatus === "FINAL" && dbGame.status !== "FINAL";
  let winnerTeam: string | null = null;
  let losingTeam: string | null = null;

  if (justFinished) {
    const homeTeam = mapTeamAbbr(homeComp.team.abbreviation);
    const awayTeam = mapTeamAbbr(awayComp.team.abbreviation);
    winnerTeam = homeScore > awayScore ? homeTeam : awayTeam;
    losingTeam = homeScore > awayScore ? awayTeam : homeTeam;
  }

  return { gameId: dbGame.id, homeScore, awayScore, status: newStatus, justFinished, winnerTeam, losingTeam };
}

/**
 * Given a full ESPN scoreboard response and a set of already-imported externalIds,
 * return the games that need to be created.
 */
export function extractImportableGames(data: ESPNResponse, existingExternalIds: Set<string>): ImportableGame[] {
  const results: ImportableGame[] = [];

  for (const event of data.events) {
    if (existingExternalIds.has(event.id)) continue;

    const competition = event.competitions[0];
    if (!competition) continue;

    const homeComp = competition.competitors.find((c) => c.homeAway === "home");
    const awayComp = competition.competitors.find((c) => c.homeAway === "away");
    if (!homeComp || !awayComp) continue;

    results.push({
      externalId: event.id,
      homeTeam: mapTeamAbbr(homeComp.team.abbreviation),
      awayTeam: mapTeamAbbr(awayComp.team.abbreviation),
      kickoff: new Date(competition.date),
    });
  }

  return results;
}

/**
 * Process a full ESPN response against a set of DB games.
 * Returns a list of updates to apply — does not touch the DB itself.
 */
export function computeAllGameUpdates(data: ESPNResponse, dbGames: DbGame[]): GameUpdate[] {
  const gamesByExternalId = new Map(dbGames.map((g) => [g.externalId, g]));
  const updates: GameUpdate[] = [];

  for (const event of data.events) {
    const dbGame = gamesByExternalId.get(event.id);
    if (!dbGame) continue;

    const update = computeGameUpdate(event, dbGame);
    if (update) updates.push(update);
  }

  return updates;
}
