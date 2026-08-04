// Pure season-scoped roster logic (#120). Kept out of the API routes so it can
// be unit-tested without Prisma: the roster-edit lock, the new-season rollover,
// and the team-trophy grouping. Routes supply the DB data and call these.

/**
 * Roster edits lock once the season's first game has kicked off, so the trophy
 * can't be gamed mid-season. Before any game (or a season with no games yet)
 * it's open; an admin override bypasses this at the call site.
 *
 * @param firstKickoff earliest Game.kickoff across the season's weeks, or null
 *   if the season has no games scheduled yet.
 */
export function rostersLocked(firstKickoff: Date | null, now: Date): boolean {
  return firstKickoff !== null && now >= firstKickoff;
}

/**
 * Compute the membership rows to roll over into a new season from the prior
 * season's memberships. A rollover row is kept only if its team still exists and
 * its user still exists — a deleted team or user is skipped rather than cloned.
 * Returns the (userId, teamId) pairs to clone under the new season.
 */
export function computeRolloverMemberships(
  prior: { userId: string; teamId: string }[],
  validTeamIds: Set<string>,
  validUserIds: Set<string>
): { userId: string; teamId: string }[] {
  return prior.filter(
    (m) => validTeamIds.has(m.teamId) && validUserIds.has(m.userId)
  );
}

export interface StandingPlayer {
  id: string;
  displayName: string;
  points: number;
  winPct: number;
}

export interface TeamStanding {
  name: string;
  playerCount: number;
  avgWinPct: number;
  totalPoints: number;
  players: { displayName: string; points: number; winPct: number }[];
}

/**
 * Group players into team-trophy standings by the *given season's* membership
 * map (userId → team name). A player with no entry is teamless that season and
 * excluded from the trophy (they still appear in individual standings). Trophy
 * order is by average member win%. Because the grouping is driven by the passed
 * map, the same players yield different rosters for different seasons.
 */
export function buildTeamStandings(
  players: StandingPlayer[],
  teamNameByUserId: Map<string, string>
): TeamStanding[] {
  const teamMap = new Map<string, StandingPlayer[]>();
  for (const p of players) {
    const name = teamNameByUserId.get(p.id);
    if (!name) continue; // teamless this season → not on the trophy
    if (!teamMap.has(name)) teamMap.set(name, []);
    teamMap.get(name)!.push(p);
  }

  return Array.from(teamMap.entries())
    .map(([name, ps]) => ({
      name,
      playerCount: ps.length,
      avgWinPct: ps.reduce((sum, p) => sum + p.winPct, 0) / ps.length,
      totalPoints: ps.reduce((sum, p) => sum + p.points, 0),
      players: ps.map((p) => ({
        displayName: p.displayName,
        points: p.points,
        winPct: p.winPct,
      })),
    }))
    .sort((a, b) => b.avgWinPct - a.avgWinPct);
}
