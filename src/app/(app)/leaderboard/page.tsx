"use client";

import { useEffect, useState } from "react";
import { getTeamName } from "@/lib/nfl-teams";

interface PlayerStanding {
  id: string;
  displayName: string;
  username: string;
  teamName: string | null;
  points: number;
  wins: number;
  losses: number;
  totalPicks: number;
  winPct: number;
  picks: {
    week: number;
    label: string;
    team: string;
    result: string;
    points: number;
  }[];
}

interface TeamStanding {
  name: string;
  playerCount: number;
  avgWinPct: number;
  totalPoints: number;
  players: { displayName: string; points: number; winPct: number }[];
}

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<PlayerStanding[]>([]);
  const [teams, setTeams] = useState<TeamStanding[]>([]);
  const [tab, setTab] = useState<"players" | "teams">("players");
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((data) => {
        setPlayers(data.players);
        setTeams(data.teams);
      });
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Leaderboard</h1>

      <div className="flex gap-1">
        <button
          onClick={() => setTab("players")}
          className={`rounded-md px-3 sm:px-4 py-2 text-sm font-medium ${
            tab === "players" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"
          }`}
        >
          Players
        </button>
        <button
          onClick={() => setTab("teams")}
          className={`rounded-md px-3 sm:px-4 py-2 text-sm font-medium ${
            tab === "teams" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"
          }`}
        >
          Team Trophy
        </button>
      </div>

      {tab === "players" && (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-gray-400">#</th>
                  <th className="px-4 py-3 text-left text-gray-400">Player</th>
                  <th className="px-4 py-3 text-left text-gray-400">Team</th>
                  <th className="px-4 py-3 text-right text-gray-400">W</th>
                  <th className="px-4 py-3 text-right text-gray-400">L</th>
                  <th className="px-4 py-3 text-right text-gray-400">Win%</th>
                  <th className="px-4 py-3 text-right text-gray-400">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {players.map((player, i) => (
                  <tr
                    key={player.id}
                    className="hover:bg-gray-800/50 cursor-pointer"
                    onClick={() =>
                      setExpandedPlayer(
                        expandedPlayer === player.id ? null : player.id
                      )
                    }
                  >
                    <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{player.displayName}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {player.teamName ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-green-400">
                      {player.wins}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400">
                      {player.losses}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(player.winPct * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {player.points}
                    </td>
                  </tr>
                ))}
                {players.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No players yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Expanded player picks (desktop) */}
            {expandedPlayer && (
              <div className="border-t border-gray-700 bg-gray-900 px-4 py-3">
                {(() => {
                  const player = players.find((p) => p.id === expandedPlayer);
                  if (!player || player.picks.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {player.picks
                        .sort((a, b) => a.week - b.week)
                        .map((pick) => (
                          <span
                            key={pick.week}
                            className={`inline-flex items-center rounded-md px-2 py-1 text-xs ${
                              pick.result === "WIN"
                                ? "bg-green-900/50 text-green-300"
                                : pick.result === "LOSS"
                                ? "bg-red-900/50 text-red-300"
                                : "bg-gray-800 text-gray-400"
                            }`}
                          >
                            {pick.label}: {getTeamName(pick.team)}
                            {pick.points > 0 && ` (+${pick.points})`}
                          </span>
                        ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Mobile card layout */}
          <div className="sm:hidden space-y-2">
            {players.map((player, i) => (
              <div key={player.id}>
                <button
                  onClick={() =>
                    setExpandedPlayer(
                      expandedPlayer === player.id ? null : player.id
                    )
                  }
                  className="w-full rounded-lg border border-gray-700 bg-gray-800/50 p-3 text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm w-5">{i + 1}</span>
                      <div>
                        <div className="font-medium">{player.displayName}</div>
                        {player.teamName && (
                          <div className="text-xs text-gray-500">{player.teamName}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{player.points} pts</div>
                      <div className="text-xs text-gray-400">
                        <span className="text-green-400">{player.wins}W</span>
                        {" "}
                        <span className="text-red-400">{player.losses}L</span>
                        {" "}
                        {(player.winPct * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </button>
                {expandedPlayer === player.id && player.picks.length > 0 && (
                  <div className="mt-1 rounded-lg bg-gray-900 p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {player.picks
                        .sort((a, b) => a.week - b.week)
                        .map((pick) => (
                          <span
                            key={pick.week}
                            className={`inline-flex items-center rounded-md px-2 py-1 text-xs ${
                              pick.result === "WIN"
                                ? "bg-green-900/50 text-green-300"
                                : pick.result === "LOSS"
                                ? "bg-red-900/50 text-red-300"
                                : "bg-gray-800 text-gray-400"
                            }`}
                          >
                            W{pick.week}: {pick.team}
                            {pick.points > 0 && ` +${pick.points}`}
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {players.length === 0 && (
              <div className="text-center py-8 text-gray-500">No players yet</div>
            )}
          </div>
        </>
      )}

      {tab === "teams" && (
        <div className="space-y-3">
          {teams.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No teams formed yet
            </div>
          )}
          {teams.map((team, i) => (
            <div
              key={team.name}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-3 sm:p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-gray-500 mr-2">#{i + 1}</span>
                  <span className="text-base sm:text-lg font-semibold">{team.name}</span>
                  <span className="ml-2 text-xs sm:text-sm text-gray-400">
                    {team.playerCount} players
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-base sm:text-lg font-semibold">
                    {(team.avgWinPct * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-400">Avg Win %</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {team.players.map((p) => (
                  <span
                    key={p.displayName}
                    className="rounded-md bg-gray-700 px-2 py-1 text-xs"
                  >
                    {p.displayName} ({p.points}pts, {(p.winPct * 100).toFixed(0)}%)
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
