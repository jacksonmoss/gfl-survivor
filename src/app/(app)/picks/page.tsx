"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getTeamName, NFL_TEAMS } from "@/lib/nfl-teams";

interface Week {
  id: string;
  weekNumber: number;
  label: string;
  isPlayoff: boolean;
  pointValue: number;
  pickDeadline: string;
  games: Game[];
}

interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  kickoff: string;
}

interface Pick {
  id: string;
  weekId: string;
  team: string;
  result: string;
  points: number;
  week: Week;
}

interface Season {
  id: string;
  year: number;
  weeks: Week[];
}

function isTeamLocked(team: string, games: Game[]): boolean {
  const game = games.find((g) => g.homeTeam === team || g.awayTeam === team);
  if (!game) return true;
  return new Date() >= new Date(game.kickoff);
}

function allGamesStarted(games: Game[]): boolean {
  if (games.length === 0) return false;
  return games.every((g) => new Date() >= new Date(g.kickoff));
}

export default function PicksPage() {
  const [season, setSeason] = useState<Season | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [usedTeams, setUsedTeams] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<Week | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedWeekRef = useRef<string | null>(null);

  const fetchPicks = useCallback(async (preserveWeek = false) => {
    const res = await fetch("/api/picks");
    const data = await res.json();
    setSeason(data.season);
    setPicks(data.picks);
    setUsedTeams(data.usedTeams);

    if (data.season?.weeks) {
      if (preserveWeek && selectedWeekRef.current) {
        const kept = data.season.weeks.find((w: Week) => w.id === selectedWeekRef.current);
        if (kept) {
          setSelectedWeek(kept);
          return;
        }
      }
      const currentWeek = data.season.weeks.find(
        (w: Week) => w.games.length === 0 || !allGamesStarted(w.games)
      );
      const week = currentWeek ?? data.season.weeks[data.season.weeks.length - 1];
      setSelectedWeek(week);
      selectedWeekRef.current = week.id;
    }
  }, []);

  useEffect(() => {
    fetchPicks();
  }, [fetchPicks]);

  // Poll for live score updates every 30s when games are active
  useEffect(() => {
    if (!season) return;

    const hasLiveOrStartedGames = season.weeks.some((w) =>
      w.games.some((g) => {
        if (g.status === "LIVE") return true;
        if (g.status === "SCHEDULED" && new Date() >= new Date(g.kickoff)) return true;
        return false;
      })
    );

    if (!hasLiveOrStartedGames) return;

    const interval = setInterval(async () => {
      await fetch("/api/scores/sync", { method: "POST" }).catch(() => {});
      fetchPicks(true);
    }, 30_000);

    return () => clearInterval(interval);
  }, [season, fetchPicks]);

  async function submitPick(team: string) {
    if (!selectedWeek) return;
    setSubmitting(true);
    setError("");
    setSuccess("");

    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId: selectedWeek.id, team }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
    } else {
      setSuccess(`Picked ${getTeamName(team)}`);
      fetchPicks();
    }
    setSubmitting(false);
  }

  if (!season) {
    return (
      <div className="text-center py-20 text-gray-400">
        <h2 className="text-xl font-semibold mb-2">No Active Season</h2>
        <p>Waiting for the admin to set up the season.</p>
      </div>
    );
  }

  const currentPick = picks.find((p) => p.weekId === selectedWeek?.id);
  const teamsThisWeek = selectedWeek?.games
    ? [...new Set(selectedWeek.games.flatMap((g) => [g.homeTeam, g.awayTeam]))]
    : [];

  // Can the user still make/change a pick?
  const currentPickLocked = currentPick && selectedWeek
    ? isTeamLocked(currentPick.team, selectedWeek.games)
    : false;
  const anyTeamsAvailable = selectedWeek
    ? teamsThisWeek.some((t) => !isTeamLocked(t, selectedWeek.games))
    : false;
  const canPick = !currentPickLocked && anyTeamsAvailable;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">{season.year} Season</h1>
        <div className="text-sm text-gray-400">
          {picks.reduce((sum, p) => sum + p.points, 0)} pts
        </div>
      </div>

      {/* Week selector dropdown */}
      <select
        value={selectedWeek?.id ?? ""}
        onChange={(e) => {
          const week = season.weeks.find((w) => w.id === e.target.value);
          if (week) {
            setSelectedWeek(week);
            selectedWeekRef.current = week.id;
            setError("");
            setSuccess("");
          }
        }}
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
      >
        {season.weeks.map((week) => {
          const pick = picks.find((p) => p.weekId === week.id);
          const label = week.isPlayoff
            ? `${week.label} (${week.pointValue}pt)`
            : `Week ${week.weekNumber}`;
          const status = pick
            ? pick.result === "WIN"
              ? " ✓"
              : pick.result === "LOSS"
              ? " ✗"
              : " •"
            : "";
          return (
            <option key={week.id} value={week.id}>
              {label}{status}
            </option>
          );
        })}
      </select>

      {/* Selected week content */}
      {selectedWeek && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <h2 className="text-lg font-semibold">{selectedWeek.label}</h2>
            <div className="text-xs sm:text-sm text-gray-400">
              {selectedWeek.isPlayoff
                ? `${selectedWeek.pointValue} pts per correct pick`
                : "1 pt per correct pick"}
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-900/50 border border-red-700 p-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md bg-green-900/50 border border-green-700 p-3 text-sm text-green-300">
              {success}
            </div>
          )}

          {/* Current pick banner */}
          {currentPick && (
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 sm:p-4">
              <div className="text-xs text-gray-400">Your pick</div>
              <div className="mt-1 text-base sm:text-lg font-semibold flex items-center gap-2 flex-wrap">
                {getTeamName(currentPick.team)}
                <span
                  className={`text-xs sm:text-sm ${
                    currentPick.result === "WIN"
                      ? "text-green-400"
                      : currentPick.result === "LOSS"
                      ? "text-red-400"
                      : "text-gray-500"
                  }`}
                >
                  {currentPick.result === "PENDING"
                    ? currentPickLocked ? "(Locked)" : "(Pending)"
                    : currentPick.result}
                </span>
              </div>
            </div>
          )}

          {/* Games this week */}
          {selectedWeek.games.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-400">Games</h3>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                {selectedWeek.games.map((game) => {
                  const kicked = new Date() >= new Date(game.kickoff);
                  return (
                    <div
                      key={game.id}
                      className="rounded-lg border border-gray-700 bg-gray-800/50 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm ${game.status === "LIVE" ? "text-green-400" : ""}`}>
                          {getTeamName(game.awayTeam)} @ {getTeamName(game.homeTeam)}
                        </span>
                        <span className="text-xs flex-shrink-0">
                          {game.status === "FINAL" && (
                            <span className="text-gray-500">
                              {game.awayScore} - {game.homeScore}
                            </span>
                          )}
                          {game.status === "LIVE" && (
                            <span className="text-green-400 flex items-center gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                              {game.awayScore} - {game.homeScore}
                            </span>
                          )}
                          {game.status === "SCHEDULED" && (
                            <span className={kicked ? "text-yellow-500" : "text-gray-500"}>
                              {kicked
                                ? "Locked"
                                : new Date(game.kickoff).toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Team picker */}
          {canPick && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-400">
                {currentPick ? "Change your pick" : "Make your pick"}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {NFL_TEAMS.filter((t) => teamsThisWeek.includes(t.abbr)).map(
                  (team) => {
                    const isUsed =
                      usedTeams.includes(team.abbr) &&
                      currentPick?.team !== team.abbr;
                    const isCurrent = currentPick?.team === team.abbr;
                    const locked = isTeamLocked(team.abbr, selectedWeek.games);
                    const disabled = isUsed || locked || submitting;
                    return (
                      <button
                        key={team.abbr}
                        disabled={disabled}
                        onClick={() => submitPick(team.abbr)}
                        className={`rounded-lg border p-2.5 sm:p-3 text-left text-sm transition-colors ${
                          isCurrent
                            ? "border-blue-500 bg-blue-900/30 text-white"
                            : disabled
                            ? "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
                            : "border-gray-700 bg-gray-800 text-white hover:border-blue-500 active:bg-gray-700"
                        }`}
                      >
                        <div className="font-semibold">{team.abbr}</div>
                        <div className="text-xs text-gray-400 truncate">{team.name}</div>
                        {isUsed && (
                          <div className="mt-0.5 text-xs text-gray-600">Used</div>
                        )}
                        {locked && !isUsed && (
                          <div className="mt-0.5 text-xs text-yellow-600">Locked</div>
                        )}
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* Pick history */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-400">Season Picks</h3>
            {/* Mobile: card layout / Desktop: table */}
            <div className="hidden sm:block rounded-lg border border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-400">Week</th>
                    <th className="px-4 py-2 text-left text-gray-400">Pick</th>
                    <th className="px-4 py-2 text-left text-gray-400">Result</th>
                    <th className="px-4 py-2 text-right text-gray-400">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {picks
                    .sort((a, b) => a.week.weekNumber - b.week.weekNumber)
                    .map((pick) => (
                      <tr key={pick.id} className="hover:bg-gray-800/50">
                        <td className="px-4 py-2">{pick.week.label}</td>
                        <td className="px-4 py-2">{getTeamName(pick.team)}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              pick.result === "WIN"
                                ? "text-green-400"
                                : pick.result === "LOSS"
                                ? "text-red-400"
                                : "text-gray-500"
                            }
                          >
                            {pick.result}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">{pick.points}</td>
                      </tr>
                    ))}
                  {picks.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-gray-500">
                        No picks yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="sm:hidden space-y-2">
              {picks
                .sort((a, b) => a.week.weekNumber - b.week.weekNumber)
                .map((pick) => (
                  <div
                    key={pick.id}
                    className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 p-3"
                  >
                    <div>
                      <div className="text-xs text-gray-400">{pick.week.label}</div>
                      <div className="font-medium">{getTeamName(pick.team)}</div>
                    </div>
                    <div className="text-right">
                      <span
                        className={`text-sm ${
                          pick.result === "WIN"
                            ? "text-green-400"
                            : pick.result === "LOSS"
                            ? "text-red-400"
                            : "text-gray-500"
                        }`}
                      >
                        {pick.result}
                      </span>
                      {pick.points > 0 && (
                        <div className="text-xs text-gray-400">+{pick.points}</div>
                      )}
                    </div>
                  </div>
                ))}
              {picks.length === 0 && (
                <div className="text-center py-4 text-gray-500 text-sm">
                  No picks yet
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
